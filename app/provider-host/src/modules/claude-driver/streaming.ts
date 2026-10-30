import type {WhenIdle} from '#modules/idle/main'
import type {ContentEvent, Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {ClaudeSession, QueryFn} from './session'
import type {
  Options,
  SDKResultMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  PromptRecorded,
  ReplyRequest,
  ReplySession,
  SessionFile,
} from '@uz/contract/host'
import type {RunFailure} from '@uz/contract/turns'
import type {UUID} from 'node:crypto'

import {failureOf} from '#modules/failures/main'
import {createReplyRuns} from '#modules/reply-runs/main'
import {randomUUID} from 'node:crypto'

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
  whenIdle: WhenIdle
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
  /** The session the app's copy holds this entry in, once it does. */
  storedIn(uuid: string): string | null
  /** Waits for the entries on their way to the app's copy. */
  stored(): Promise<void>
}

type Mapper = ReturnType<typeof createReplyMapper>

type PromptRecords = Generator<PromptRecorded, void>

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
  })

  const sessionStore = appSessionStore(deps.store)

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
    const storedIn = new Map<string, string>()
    const storing = new Set<Promise<void>>()

    if (resume) {
      files = await deps.store.loadFiles({projectKey, sessionId: resume})
    }

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
      ...(request.model === DEFAULT_MODEL ? {} : {model: request.model}),
      ...(resume ? {resume} : {}),
      ...(fork ? {forkSession: true} : {}),
      ...(upTo ? {resumeSessionAt: upTo} : {}),
      sessionStore: {
        ...store,
        append: async (key, entries) => {
          const appending = store.append(key, entries)
          storing.add(appending)

          try {
            await appending
          } finally {
            storing.delete(appending)
          }

          if (key.subpath !== undefined) return

          for (const {uuid} of entries) {
            if (uuid !== undefined) storedIn.set(uuid, key.sessionId)
          }
        },
      },
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

    return Object.assign(openSession(deps.query, options), {
      restore,
      projectKey,
      activeConfigDir: () => activeConfigDir,
      // A fork is a new session, with nothing of its own saved yet.
      saved: new Set(fork ? [] : files.map(file => file.path)),
      storedIn: (uuid: string) => storedIn.get(uuid) ?? null,
      stored: async () => {
        await Promise.allSettled(storing)
      },
    })
  }

  /** Stop interrupts `claude` once it has the Prompt. */
  async function* reply(
    session: Live,
    mapper: Mapper,
    {prompt}: ReplyRequest,
    run: ReplyRun,
    {uuid, recordPrompt}: {uuid: UUID; recordPrompt: () => PromptRecords}
  ): AsyncGenerator<ContentEvent | PromptRecorded, Outcome> {
    let heard = false
    let unstoppable: (() => void) | null = null

    try {
      for await (const message of session.send(prompt.text, uuid)) {
        unstoppable ??= run.stoppable(async () => session.interrupt())
        heard = true
        yield* recordPrompt()

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

  /**
   * The Prompt goes out as a `uuid` of the driver's own, and is recorded once
   * the app's copy holds it, however the Reply ends: a Retry cuts there.
   */
  async function* attempt(
    session: Live,
    mapper: Mapper,
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent | PromptRecorded, Outcome> {
    const uuid = randomUUID()
    let recorded = false

    function* recordPrompt(): PromptRecords {
      const sessionId = recorded ? null : session.storedIn(uuid)

      if (sessionId === null) return

      recorded = true
      yield {
        type: 'PROMPT_RECORDED',
        treeId: request.treeId,
        replyId: request.replyId,
        session: {sessionId, messageId: uuid},
      }
    }

    const outcome = yield* reply(session, mapper, request, run, {
      uuid,
      recordPrompt,
    })

    await session.stored()
    yield* recordPrompt()

    return outcome
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
   * A rewind or a Retry's cut can't take the warm session: it has gone past
   * the message the cut keeps, and only a new `claude` resumes at it.
   */
  function claimable(request: ReplyRequest): Live | null {
    const {session} = request

    if (!session || session.type === 'fork') return null

    const claimed = warm.claim(session)

    if (claimed && cutAt(session) !== null) {
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
    mapper: Mapper,
    run: ReplyRun
  ): AsyncGenerator<
    ContentEvent | PromptRecorded,
    {session: Live; outcome: Outcome}
  > {
    const claimed = claimable(request)

    if (claimed) {
      const outcome = yield* attempt(claimed, mapper, request, run)

      if (!('failure' in outcome) || outcome.heard || !claimed.ended) {
        return {session: claimed, outcome}
      }

      warm.drop(claimed)
    }

    const session = await open(request, request.session ? 'store' : 'none')
    warm.add(session)
    const outcome = yield* attempt(session, mapper, request, run)
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
      outcome: yield* attempt(fallback, mapper, request, run),
    }
  }

  /** A failed Reply's `claude` closes; a refused save fails the Reply too. */
  async function* write(
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent | PromptRecorded, Ending> {
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
