import type {WhenIdle} from '#modules/idle/main'
import type {ContentEvent, Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {ClaudeSession, QueryFn} from './session'
import type {
  ModelInfo,
  Options,
  SDKResultMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest, ReplySession, SessionFile} from '@uz/contract/host'
import type {RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'
import {createReplyRuns} from '#modules/reply-runs/main'

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

export interface ClaudeRepliesDeps {
  store: SessionStoreClient
  query: QueryFn
  spawn: (options: SpawnOptions) => SpawnedProcess
  env: NodeJS.ProcessEnv
  whenIdle: WhenIdle
  maxWarm: number
  learnModels: (models: ModelInfo[]) => void
  resolveModel: (id: string) => string
}

type Restore = 'none' | 'store' | 'file'

interface Live extends ClaudeSession {
  model: string
  restore: Restore
  projectKey: string
  /** The SDK swaps in its own configuration folder on a restore. */
  activeConfigDir: () => string
  saved: Set<string>
}

type Mapper = ReturnType<typeof createReplyMapper>

/** The last message kept, when a fork, a rewind or a Retry's cut cuts it. */
function cutAt(session: ReplySession) {
  switch (session.type) {
    case 'continue':
      return null
    case 'fork':
    case 'rewind':
      return session.messageId
    case 'cut':
      return session.keepThrough
    default:
      throw new Error('Unknown session.')
  }
}

function servedThrough(session: ReplyRequest['session']) {
  return session?.type === 'fork' ? session.servedThrough : undefined
}

function resumption(session: ReplyRequest['session'], restore: Restore) {
  if (!session || restore === 'none') {
    return {resume: null, fork: false, upTo: null}
  }

  return {
    resume: session.sessionId,
    fork: session.type === 'fork',
    upTo: cutAt(session),
  }
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
    whenIdle: deps.whenIdle,
    max: deps.maxWarm,
    resolveModel: deps.resolveModel,
  })

  /** Waits for a closing `claude` in the session, which may still write to it. */
  async function open(request: ReplyRequest, restore: Restore): Promise<Live> {
    const {program, configDir} = request.vendorProgram

    if (!program) throw new Error('The manifest names no Claude program.')

    if (request.session) await warm.closed(request.session.sessionId)

    const cwd = configDir
    const projectKey = projectKeyOf(cwd)
    const {resume, fork, upTo} = resumption(request.session, restore)
    let files: SessionFile[] = []
    let activeConfigDir = configDir

    if (resume) {
      files = await deps.store.loadFiles({projectKey, sessionId: resume})
    }

    const sessionStore = appSessionStore(
      deps.store,
      servedThrough(request.session)
    )

    // The fallback resumes from the transcript written back, not the store.
    const store =
      restore === 'file'
        ? {...sessionStore, load: async () => null, listSubkeys: async () => []}
        : sessionStore

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
      model: request.model,
      ...(resume ? {resume} : {}),
      ...(fork ? {forkSession: true} : {}),
      ...(upTo ? {resumeSessionAt: upTo} : {}),
      sessionStore: store,
      // Each entry reaches the app as it is written, not at the result, so a
      // Reply the app quits in keeps its Prompt.
      sessionStoreFlush: 'eager',
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

    const session = openSession(deps.query, options)

    void session
      .models()
      .then(deps.learnModels)
      .catch(() => undefined)

    return Object.assign(session, {
      model: request.model,
      restore,
      projectKey,
      activeConfigDir: () => activeConfigDir,
      // A fork is a new session, with nothing of its own saved yet.
      saved: new Set(fork ? [] : files.map(file => file.path)),
    })
  }

  /**
   * The Prompt goes out under the id main gave it, and main records it as it
   * stores the entry. Stop interrupts `claude` once it has the Prompt.
   */
  async function* reply(
    session: Live,
    mapper: Mapper,
    {prompt}: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Outcome> {
    let heard = false
    let unstoppable: (() => void) | null = null

    try {
      for await (const message of session.send(prompt.text, prompt.messageId)) {
        unstoppable ??= run.stoppable(async () => session.interrupt())
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
      unstoppable?.()
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

  /**
   * A rewind or a Retry's cut needs a new `claude` to resume at the cut, and
   * `claude` takes a Model only as it starts.
   */
  function claimable(request: ReplyRequest): Live | null {
    const {session} = request

    if (!session || session.type === 'fork') return null

    const claimed = warm.claim(session, request.model)

    if (claimed && cutAt(session) !== null) {
      warm.drop(claimed)

      return null
    }

    return claimed
  }

  /**
   * A warm `claude` that exited while idle is replaced; a store restore that
   * `claude` refuses falls back to the transcript written back.
   */
  async function* answer(
    request: ReplyRequest,
    mapper: Mapper,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, {session: Live; outcome: Outcome}> {
    const claimed = claimable(request)

    if (claimed) {
      const outcome = yield* reply(claimed, mapper, request, run)

      if (!('failure' in outcome) || outcome.heard || !claimed.ended) {
        return {session: claimed, outcome}
      }

      warm.drop(claimed)
    }

    const session = await open(request, request.session ? 'store' : 'none')
    warm.add(session)
    const outcome = yield* reply(session, mapper, request, run)
    const refused = !session.started && session.restore === 'store'

    if (!refused || !request.session) return {session, outcome}

    warm.drop(session)

    const writtenBack = await writeTranscriptBack(
      deps.store,
      {
        configDir: request.vendorProgram.configDir,
        projectKey: session.projectKey,
        sessionId: request.session.sessionId,
      },
      servedThrough(request.session)
    )

    if (!writtenBack) return {session, outcome}

    const fallback = await open(request, 'file')
    warm.add(fallback)

    return {
      session: fallback,
      outcome: yield* reply(fallback, mapper, request, run),
    }
  }

  /** A refused save of the tool results fails the Reply. */
  async function* write(
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Ending> {
    const {treeId, replyId} = request
    const ids = {treeId, replyId}
    const mapper = createReplyMapper(ids)
    const {session, outcome} = yield* answer(request, mapper, run)

    run.afterward(status => {
      if (status === 'failed' || session.ended) warm.drop(session)
      else warm.release(session)
    })

    if ('failure' in outcome) {
      return {
        finished: {
          ...ids,
          type: 'RUN_FINISHED',
          status: 'failed',
          failure: outcome.failure,
        },
      }
    }

    const finished = mapper.finished(outcome.result)

    if (finished.status === 'failed') return {finished}

    const recorded = mapper.recorded()
    const {sessionId} = session

    if (sessionId) await saveToolResults(session, sessionId)

    session.messageId = recorded?.uuid ?? null

    return {
      finished,
      recorded:
        recorded && sessionId
          ? {
              ...ids,
              type: 'REPLY_RECORDED',
              model: recorded.model,
              session: {sessionId, messageId: recorded.uuid},
            }
          : null,
    }
  }

  return {
    ...createReplyRuns(write),
    /** `claude` cuts with `resumeSessionAt` when the next Prompt resumes. */
    cutSession: async () => false,
  }
}
