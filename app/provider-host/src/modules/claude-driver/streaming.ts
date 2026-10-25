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
  /** Where `claude` files the session. */
  projectKey: string
  /** The configuration folder `claude` runs with: the SDK's own on a restore. */
  activeConfigDir: () => string
  /** Tool result files already in the app's copy. */
  saved: Set<string>
}

type Mapper = ReturnType<typeof createReplyMapper>

/**
 * How `claude` takes up the Provider session: as it stands, forked through
 * the Reply answered into a new session, or cut back to that Reply for a
 * rewind. `upTo` is the last message kept, when it is cut.
 */
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

/**
 * Claude's Replies: each Prompt goes to the warm session standing at the
 * Reply it answers, or to a `claude` that resumes the Provider session from
 * the app's copy, or that starts a new one. A Prompt that starts a Branch
 * goes to a `claude` that forks the session through the Reply it answers,
 * into a new session; the warm `claude` of the other Branch keeps going.
 */
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

  /**
   * Each Reply being written: its session once `claude` has the Prompt, and
   * whether a stop came before then, to pass on as soon as it does.
   */
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

  /** Keeps the session's new tool result files in the app's copy. */
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

  /**
   * The warm session standing at the Reply the Prompt answers, when the
   * Prompt can go to it. A fork never takes one, and a rewind can't: the
   * session it finds there has gone past that Reply, so it is closed.
   */
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
   * Sends the Prompt and streams Claude's answer, from the warm session
   * standing at the Reply answered, else a new `claude`. A warm one whose
   * `claude` exited while idle answers nothing, so a new one resumes in its
   * place. When the restore from the store doesn't get `claude` going, the
   * transcript is written back and it goes again from there. A fork always
   * gets a new `claude`: no warm session is claimed, and none is closed. So
   * does a rewind, which resumes the session cut back to the Reply answered.
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

  /**
   * Interrupts the Turn writing the Reply, once `claude` has taken the
   * request; the Reply's stream goes on to its `RUN_FINISHED`. A stop before
   * `claude` has the Prompt is passed on as soon as it does. Nothing when no
   * Reply by that id is being written.
   */
  async function stop(replyId: string) {
    const entry = writing.get(replyId)

    if (!entry) return

    if (entry.session) await entry.session.interrupt()
    else entry.stopAsked = true
  }

  return {startReply, stop}
}
