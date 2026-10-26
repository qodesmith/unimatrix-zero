import type {SessionStoreClient} from '#modules/session-store/main'
import type {ClaudeSession, QueryFn} from './session'
import type {
  Options,
  SDKResultMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRecorded, ReplyRequest, SessionFile} from '@uz/contract/host'
import type {ReplyEvent, RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'

import {claudeEnvironment} from './environment'
import {createReplyMapper} from './replies'
import {openSession} from './session'
import {
  appSessionStore,
  projectKeyOf,
  readNewToolResults,
  restoreFiles,
  writeTranscriptBack,
} from './transcripts'
import {createWarmSessions} from './warm'

/** The Model id that leaves the choice to Claude: the plan's default. */
export const DEFAULT_MODEL = 'default'

export interface ClaudeRepliesDeps {
  store: SessionStoreClient
  query: QueryFn
  spawn: (options: SpawnOptions) => SpawnedProcess
  env: NodeJS.ProcessEnv
  idleMs: number
  maxWarm: number
}

/** How a session's earlier Turns reach `claude`. */
type Restore = 'none' | 'store' | 'file'

interface Live extends ClaudeSession {
  restore: Restore
  projectKey: string
  /** The SDK swaps in its own configuration folder on a restore. */
  activeConfigDir: () => string
  /** Tool result files already in the app's copy. */
  saved: Set<string>
}

type Mapper = ReturnType<typeof createReplyMapper>

/** `upTo` is the last message kept, when a fork or rewind cuts the session. */
function resumption(session: ReplyRequest['session'], restore: Restore) {
  if (!session || restore === 'none') {
    return {resume: null, fork: false, upTo: null}
  }

  const {sessionId: resume, fork, rewind, messageId} = session

  return {resume, fork, upTo: fork || rewind ? messageId : null}
}

/** `heard` says whether `claude` sent anything back to the Prompt. */
type Outcome =
  | {result: SDKResultMessage}
  | {failure: RunFailure; heard: boolean}

function crashed(message: string): RunFailure {
  return {code: 'program-crashed', message}
}

/** Replies from a warm `claude`, or a new one that resumes, forks or starts. */
export function createClaudeReplies(deps: ClaudeRepliesDeps) {
  const warm = createWarmSessions<Live>({
    idleMs: deps.idleMs,
    max: deps.maxWarm,
  })

  const sessionStore = appSessionStore(deps.store)

  async function open(request: ReplyRequest, restore: Restore): Promise<Live> {
    const {program, configDir} = request.vendorProgram

    if (!program) throw new Error('The manifest names no Claude program.')

    const cwd = configDir
    const projectKey = projectKeyOf(cwd)
    const {resume, fork, upTo} = resumption(request.session, restore)
    let files: SessionFile[] = []
    let activeConfigDir = configDir

    if (resume) {
      files = await deps.store.loadFiles({projectKey, sessionId: resume})
    }

    const options: Options = {
      pathToClaudeCodeExecutable: program.path,
      env: claudeEnvironment(deps.env, configDir),
      cwd,
      settingSources: [],
      settings: {autoMemoryEnabled: false},
      tools: [],
      strictMcpConfig: true,
      mcpServers: {},
      includePartialMessages: true,
      thinking: {type: 'adaptive', display: 'summarized'},
      systemPrompt: request.systemPrompt,
      ...(request.model === DEFAULT_MODEL ? {} : {model: request.model}),
      ...(resume ? {resume} : {}),
      ...(fork ? {forkSession: true} : {}),
      ...(upTo ? {resumeSessionAt: upTo} : {}),
      // The fallback resumes from the transcript written back, not the store.
      sessionStore:
        restore === 'file'
          ? {
              ...sessionStore,
              load: async () => null,
              listSubkeys: async () => [],
            }
          : sessionStore,
      spawnClaudeCodeProcess: spawnOptions => {
        activeConfigDir = spawnOptions.env.CLAUDE_CONFIG_DIR ?? configDir

        if (resume) {
          restoreFiles(
            {configDir: activeConfigDir, projectKey, sessionId: resume},
            files
          )
        }

        return deps.spawn(spawnOptions)
      },
    }

    return Object.assign(openSession(deps.query, options), {
      restore,
      projectKey,
      activeConfigDir: () => activeConfigDir,
      // A fork is a new session, with nothing of its own saved yet.
      saved: new Set(fork ? [] : files.map(file => file.path)),
    })
  }

  /** A stop asked before `claude` has the Prompt waits in `stopAsked`. */
  const writing = new Map<string, {session: Live | null; stopAsked: boolean}>()

  async function* attempt(
    session: Live,
    mapper: Mapper,
    {replyId, prompt}: ReplyRequest
  ): AsyncGenerator<ReplyEvent, Outcome> {
    let heard = false
    const entry = writing.get(replyId)

    try {
      for await (const message of session.send(prompt.text)) {
        if (!heard && entry) {
          entry.session = session

          if (entry.stopAsked) void session.interrupt().catch(() => undefined)
        }

        heard = true

        if (message.type === 'result') return {result: message}

        yield* mapper.map(message)
      }

      return {
        failure: crashed('Claude stopped before finishing this Reply.'),
        heard,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Once heard, the only thing that throws is `claude` going away.
      return {failure: heard ? crashed(message) : failureOf(message), heard}
    } finally {
      if (entry) entry.session = null
    }
  }

  async function saveToolResults(session: Live, sessionId: string) {
    const files = readNewToolResults(
      {
        configDir: session.activeConfigDir(),
        projectKey: session.projectKey,
        sessionId,
      },
      session.saved
    )

    if (files.length === 0) return

    await deps.store.saveFiles(
      {projectKey: session.projectKey, sessionId},
      files
    )

    for (const file of files) session.saved.add(file.path)
  }

  /** A rewind can't take the warm session: it has gone past that Reply. */
  function claimable(request: ReplyRequest): Live | null {
    const {session} = request

    if (!session || session.fork) return null

    const claimed = warm.claim(session)

    if (claimed && session.rewind) {
      warm.drop(claimed)

      return null
    }

    return claimed
  }

  /**
   * A warm `claude` that exited while idle answers nothing, so a new one
   * resumes in its place. When the restore from the store doesn't get
   * `claude` going, the transcript is written back and it goes again.
   */
  async function* answer(
    request: ReplyRequest,
    mapper: Mapper
  ): AsyncGenerator<ReplyEvent, {session: Live; outcome: Outcome}> {
    const claimed = claimable(request)

    if (claimed) {
      const outcome = yield* attempt(claimed, mapper, request)

      if (!('failure' in outcome) || outcome.heard || !claimed.ended) {
        return {session: claimed, outcome}
      }

      warm.drop(claimed)
    }

    const session = await open(request, request.session ? 'store' : 'none')
    warm.add(session)
    const outcome = yield* attempt(session, mapper, request)
    const refused = !session.started && session.restore === 'store'

    if (!refused || !request.session) return {session, outcome}

    warm.drop(session)

    const writtenBack = await writeTranscriptBack(deps.store, {
      configDir: request.vendorProgram.configDir,
      projectKey: session.projectKey,
      sessionId: request.session.sessionId,
    })

    if (!writtenBack) return {session, outcome}

    const fallback = await open(request, 'file')
    warm.add(fallback)

    return {
      session: fallback,
      outcome: yield* attempt(fallback, mapper, request),
    }
  }

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    writing.set(request.replyId, {session: null, stopAsked: false})

    try {
      yield* write(request)
    } finally {
      writing.delete(request.replyId)
    }
  }

  async function* write(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    const {treeId, replyId} = request
    const ids = {treeId, replyId}
    const mapper = createReplyMapper(ids)

    yield {...ids, type: 'RUN_STARTED'}

    const {session, outcome} = yield* answer(request, mapper)

    if ('failure' in outcome) {
      warm.drop(session)
      yield {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: outcome.failure,
      }

      return
    }

    const finished = mapper.finished(outcome.result)
    const recorded = mapper.recorded()
    const {sessionId} = session

    if (finished.status === 'failed') {
      warm.drop(session)
      yield finished

      return
    }

    if (sessionId) await saveToolResults(session, sessionId)

    session.messageId = recorded?.uuid ?? null

    if (recorded && sessionId) {
      yield {
        ...ids,
        type: 'REPLY_RECORDED',
        model: recorded.model,
        session: {sessionId, messageId: recorded.uuid},
      }
    }

    if (session.ended) warm.drop(session)
    else warm.release(session)

    yield finished
  }

  /** The Reply's stream still goes on to its `RUN_FINISHED`. */
  async function stop(replyId: string) {
    const entry = writing.get(replyId)

    if (!entry) return

    if (entry.session) await entry.session.interrupt()
    else entry.stopAsked = true
  }

  return {startReply, stop}
}
