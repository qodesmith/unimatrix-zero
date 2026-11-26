import type {Approvals} from '#modules/approvals/main'
import type {WhenIdle} from '#modules/idle/main'
import type {ContentPart} from '#modules/prompt-content/main'
import type {ContentEvent, Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {Silent, WhenSilent} from './heard'
import type {Outcome} from './outcome'
import type {SessionApprovals} from './permissions'
import type {Restore} from './resumption'
import type {ClaudeSession, QueryFn} from './session'
import type {ClaudeSignInDeps} from './sign-in'
import type {
  ModelInfo,
  Options,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest, SessionFile} from '@uz/contract/host'
import type {PermissionMode} from '@uz/contract/permissions'
import type {CompactionSettings} from '@uz/contract/settings'
import type {TreeTools} from '@uz/contract/tools'
import type {RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'
import {createReplyRuns} from '#modules/reply-runs/main'

import {createApprovalFeed} from './approval-feed'
import {firstHeard, silentEnding, startingWith} from './heard'
import {replyOptions} from './options'
import {sessionLost} from './outcome'
import {createReplyMapper} from './replies'
import {contentOf, cutAt, resumption, servedThrough} from './resumption'
import {openSession} from './session'
import {
  appSessionStore,
  projectKeyOf,
  readNewToolResults,
  restoreFiles,
  underOneKey,
  writeTranscriptBack,
} from './transcripts'
import {createWarmSessions} from './warm'

export interface ClaudeRepliesDeps {
  store: SessionStoreClient
  query: QueryFn
  spawn: (options: SpawnOptions) => SpawnedProcess
  hostEnv: ClaudeSignInDeps['hostEnv']
  whenIdle: WhenIdle
  maxWarm: number
  whenSilent: WhenSilent
  platform: NodeJS.Platform
  learnModels: (models: ModelInfo[]) => void
  resolveModel: (id: string) => string
  approvals: Approvals
}

interface Live extends ClaudeSession {
  model: string
  compactionSettings: CompactionSettings
  systemPrompt: string
  tools: TreeTools
  permissionMode: PermissionMode
  asking: SessionApprovals
  restore: Restore
  store: SessionStoreClient
  projectKey: string
  /** The SDK swaps in its own configuration folder on a restore. */
  activeConfigDir: () => string
  saved: Set<string>
}

type Mapper = ReturnType<typeof createReplyMapper>

interface Sending {
  request: ReplyRequest
  content: ContentPart[]
}

type Answered =
  | {session: Live; outcome: Outcome}
  | {session: null; outcome: Silent}

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

  function storeFor(request: ReplyRequest) {
    return underOneKey(
      deps.store,
      projectKeyOf(request.vendorProgram.configDir)
    )
  }

  /** A closing `claude` may still write to the session, so wait for it. */
  async function filesOf(request: ReplyRequest, restore: Restore) {
    if (request.session) await warm.closed(request.session.sessionId)

    const {resume} = resumption(request.session, restore)

    return resume
      ? storeFor(request).loadFiles({
          projectKey: projectKeyOf(request.treeFolder),
          sessionId: resume,
        })
      : []
  }

  async function open(
    request: ReplyRequest,
    restore: Restore,
    run: ReplyRun
  ): Promise<Live | Silent> {
    const {program} = request.vendorProgram

    if (!program) throw new Error('The manifest names no Claude program.')

    const stop = {asked: false, ...Promise.withResolvers<Silent>()}

    const unstoppable = run.stoppable(async () => {
      stop.asked = true
      stop.resolve({silent: 'stopped'})
    })

    try {
      const ready = await Promise.race([
        Promise.all([
          filesOf(request, restore),
          deps.hostEnv(request.vendorProgram),
        ]),
        stop.promise,
      ])

      // A Stop can lose the race to a `filesOf` with nothing to wait for.
      if ('silent' in ready || stop.asked) return {silent: 'stopped'}

      const [files, env] = ready

      return start(request, restore, {files, env}, program)
    } finally {
      unstoppable()
    }
  }

  function start(
    request: ReplyRequest,
    restore: Restore,
    {files, env}: {files: SessionFile[]; env: NodeJS.ProcessEnv},
    program: NonNullable<ReplyRequest['vendorProgram']['program']>
  ): Live {
    const {configDir} = request.vendorProgram
    const projectKey = projectKeyOf(request.treeFolder)
    const {resume, fork, upTo} = resumption(request.session, restore)
    let activeConfigDir = configDir
    const appCopy = storeFor(request)
    const asking: SessionApprovals = {current: null}

    const sessionStore = appSessionStore(
      appCopy,
      servedThrough(request.session)
    )

    // The fallback resumes from the transcript written back, not the store.
    const store =
      restore === 'file'
        ? {...sessionStore, load: async () => null, listSubkeys: async () => []}
        : sessionStore

    const options: Options = {
      ...replyOptions(request, program.path, env, deps.platform, asking),
      ...(resume ? {resume} : {}),
      ...(fork ? {forkSession: true} : {}),
      ...(upTo ? {resumeSessionAt: upTo} : {}),
      sessionStore: store,
      // So a Reply the app quits in keeps its Prompt.
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
      systemPrompt: request.systemPrompt,
      tools: request.tools,
      permissionMode: request.permissionMode,
      asking,
      restore,
      store: appCopy,
      projectKey,
      activeConfigDir: () => activeConfigDir,
      // A fork is a new session, with nothing of its own saved yet.
      saved: new Set(fork ? [] : files.map(file => file.path)),
    })
  }

  async function* reply(
    session: Live,
    mapper: Mapper,
    {request, content}: Sending,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Outcome> {
    const messages = session.send(content, request.prompt.messageId)
    let heard = false
    let unstoppable: (() => void) | null = null
    const feed = createApprovalFeed()

    session.asking.current = deps.approvals.forReply(request, feed.emit)

    try {
      const first = await firstHeard(messages, run, deps.whenSilent)

      if ('silent' in first) {
        // Else a `claude` only slow to start goes on to write the Reply.
        void session.interrupt().catch(() => undefined)

        return first
      }

      if (!first.done) {
        heard = true
        unstoppable = run.stoppable(async () => session.interrupt())

        for await (const fed of feed.merge(
          startingWith(first.value, messages)
        )) {
          if (fed.kind === 'approval') {
            yield fed.event
            continue
          }

          if (fed.message.type === 'result') return {result: fed.message}

          yield* mapper.map(fed.message)
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
      session.asking.current = null
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

    await session.store.saveFiles(
      {projectKey: session.projectKey, sessionId},
      files
    )

    for (const file of files) session.saved.add(file.path)
  }

  /** A rewind or a Retry's cut needs a new `claude` that resumes at the cut. */
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

  async function* replyOnce(
    request: ReplyRequest,
    mapper: Mapper,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Answered> {
    // Before any `claude`, so an unreadable file leaves none to close.
    const sending: Sending = {request, content: await contentOf(request)}
    const claimed = claimable(request)

    if (claimed) {
      const outcome = yield* reply(claimed, mapper, sending, run)

      if (!('failure' in outcome) || outcome.heard || !claimed.ended) {
        return {session: claimed, outcome}
      }

      warm.drop(claimed)
    }

    const session = await open(request, request.session ? 'store' : 'none', run)

    if ('silent' in session) return {session: null, outcome: session}

    warm.add(session)
    const outcome = yield* reply(session, mapper, sending, run)

    const refused =
      !('silent' in outcome) && !session.started && session.restore === 'store'

    if (!refused || !request.session) return {session, outcome}

    warm.drop(session)

    const writtenBack = await writeTranscriptBack(
      session.store,
      {
        configDir: request.vendorProgram.configDir,
        projectKey: session.projectKey,
        sessionId: request.session.sessionId,
      },
      servedThrough(request.session)
    )

    if (!writtenBack) return {session, outcome}

    const fallback = await open(request, 'file', run)

    if ('silent' in fallback) return {session: null, outcome: fallback}

    warm.add(fallback)

    return {
      session: fallback,
      outcome: yield* reply(fallback, mapper, sending, run),
    }
  }

  /** Exact restore first, then a new session told the Thread (ADR 0001). */
  async function* answer(
    request: ReplyRequest,
    mapper: Mapper,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Answered> {
    const {treeId, replyId, thread} = request
    const rebuilt = {treeId, replyId, type: 'SESSION_REBUILT'} as const

    if (!request.session) {
      if (thread.length > 0) yield rebuilt

      return yield* replyOnce(request, mapper, run)
    }

    const restored = yield* replyOnce(request, mapper, run)

    if (
      thread.length === 0 ||
      restored.session === null ||
      !sessionLost(restored.outcome)
    ) {
      return restored
    }

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
    const answered = yield* answer(request, mapper, run)

    if (answered.session === null) return silentEnding(ids, answered.outcome)

    const {session, outcome} = answered

    run.afterward(status => {
      if (status === 'failed' || session.ended || 'silent' in outcome) {
        warm.drop(session)
      } else {
        warm.release(session)
      }
    })

    if ('silent' in outcome) {
      return silentEnding(ids, outcome)
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
