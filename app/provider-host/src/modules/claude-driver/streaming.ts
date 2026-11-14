import type {WhenIdle} from '#modules/idle/main'
import type {ContentEvent, Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {Silent} from './heard'
import type {ClaudeSession, QueryFn} from './session'
import type {
  ModelInfo,
  Options,
  SDKResultMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest, ReplySession, SessionFile} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'
import type {RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'
import {createReplyRuns} from '#modules/reply-runs/main'
import {explainingLabels, replayed} from '#modules/thread-replay/main'

import {claudeReplyEnvironment} from './environment'
import {firstHeard, silentEnding, startingWith} from './heard'
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
  /** How long a Reply waits for `claude`'s first message before failing. */
  heardWithinMs: number
  learnModels: (models: ModelInfo[]) => void
  resolveModel: (id: string) => string
}

type Restore = 'none' | 'store' | 'file'

interface Live extends ClaudeSession {
  model: string
  compactionSettings: CompactionSettings
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

/** Nothing for a default, so `claude` compacts where it would on its own. */
function claudeSettingsOf({auto, threshold}: CompactionSettings) {
  return {
    ...(auto ? {} : {autoCompactEnabled: false}),
    ...(threshold === null ? {} : {autoCompactWindow: threshold}),
  }
}

/** `heard` says whether `claude` sent anything back to the Prompt. */
type Outcome =
  | {result: SDKResultMessage}
  | {failure: RunFailure; heard: boolean}
  | Silent

function crashed(message: string): RunFailure {
  return {code: 'program-crashed', message}
}

/**
 * How `claude` refuses a session it has no transcript of, and a point to
 * resume at that is off the session's newest chain. It writes nothing to the
 * session either time.
 */
const SESSION_LOST =
  /No conversation found with session ID|No message found with message\.uuid of/

function sessionLost(outcome: Outcome) {
  if ('failure' in outcome) return SESSION_LOST.test(outcome.failure.message)

  if ('silent' in outcome) return false

  const {result} = outcome

  return (
    result.subtype !== 'success' && SESSION_LOST.test(result.errors.join(' '))
  )
}

/** A session started for a Thread is told all of it with its first Prompt. */
function textOf({session, thread, prompt}: ReplyRequest) {
  return session === null && thread.length > 0
    ? replayed(thread, prompt.text)
    : prompt.text
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
      env: claudeReplyEnvironment(deps.env, configDir),
      cwd,
      settingSources: [],
      settings: {
        autoMemoryEnabled: false,
        ...claudeSettingsOf(request.compactionSettings),
      },
      tools: [],
      strictMcpConfig: true,
      mcpServers: {},
      // Else a Prompt such as `/compact` is run as a `claude` command.
      verbatimPrompts: true,
      includePartialMessages: true,
      thinking: {type: 'adaptive', display: 'summarized'},
      // On every open: `claude` keeps no System prompt with the session.
      systemPrompt: explainingLabels(request.systemPrompt, request.thread),
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
      compactionSettings: request.compactionSettings,
      restore,
      projectKey,
      activeConfigDir: () => activeConfigDir,
      // A fork is a new session, with nothing of its own saved yet.
      saved: new Set(fork ? [] : files.map(file => file.path)),
    })
  }

  /**
   * The Prompt goes out under the id main gave it, and main records it as it
   * stores the entry. Stop interrupts `claude` once it is heard; before that,
   * Stop gives up on `claude`, as the wait for it running out does.
   */
  async function* reply(
    session: Live,
    mapper: Mapper,
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Outcome> {
    const {prompt} = request
    const messages = session.send(textOf(request), prompt.messageId)
    let heard = false
    let unstoppable: (() => void) | null = null

    try {
      const first = await firstHeard(messages, run, deps.heardWithinMs)

      if ('silent' in first) {
        // Else a `claude` only slow to start goes on to write the Reply.
        void session.interrupt().catch(() => undefined)

        return first
      }

      if (!first.done) {
        heard = true
        unstoppable = run.stoppable(async () => session.interrupt())

        for await (const message of startingWith(first.value, messages)) {
          if (message.type === 'result') return {result: message}

          yield* mapper.map(message)
        }
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

    const claimed = warm.claim(session, request)

    if (claimed && cutAt(session) !== null) {
      warm.drop(claimed)

      return null
    }

    return claimed
  }

  /**
   * A null session starts a new one. A warm `claude` that exited while idle is
   * replaced; a store restore that `claude` refuses falls back to the
   * transcript written back.
   */
  async function* replyOnce(
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

    const refused =
      !('silent' in outcome) && !session.started && session.restore === 'store'

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

  /**
   * The one way a session is rebuilt from its Thread (ADR 0001): the exact
   * restore first, then, for a session `claude` no longer has, a new one told
   * the whole Thread.
   */
  async function* answer(
    request: ReplyRequest,
    mapper: Mapper,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, {session: Live; outcome: Outcome}> {
    const {treeId, replyId, thread} = request
    const rebuilt = {treeId, replyId, type: 'SESSION_REBUILT'} as const

    if (!request.session) {
      if (thread.length > 0) yield rebuilt

      return yield* replyOnce(request, mapper, run)
    }

    const restored = yield* replyOnce(request, mapper, run)

    if (thread.length === 0 || !sessionLost(restored.outcome)) return restored

    warm.drop(restored.session)
    yield rebuilt

    return yield* replyOnce({...request, session: null}, mapper, run)
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
      if (status === 'failed' || session.ended || 'silent' in outcome) {
        warm.drop(session)
      } else {
        warm.release(session)
      }
    })

    if ('silent' in outcome) {
      return silentEnding(ids, outcome, deps.heardWithinMs)
    }

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
