import type {SessionStoreClient} from '#modules/session-store/main'
import type {ClaudeSession, QueryFn} from './session'
import type {
  Options,
  SDKResultMessage,
  SpawnOptions,
  SpawnedProcess,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRecorded, ReplyRequest, SessionFile} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

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

/** `heard` says whether `claude` sent anything back to the Prompt. */
type Outcome = {result: SDKResultMessage} | {error: string; heard: boolean}

/**
 * Claude's Replies: each Prompt goes to the warm session standing at the
 * Reply it answers, or to a `claude` that resumes the Provider session from
 * the app's copy, or that starts a new one.
 */
export function createClaudeReplies(deps: ClaudeRepliesDeps) {
  const warm = createWarmSessions<Live>({
    idleMs: deps.idleMs,
    max: deps.maxWarm,
  })

  const sessionStore = appSessionStore(deps.store)

  async function open(request: ReplyRequest, restore: Restore): Promise<Live> {
    const {program, configDir} = request.vendor

    if (!program) throw new Error('The manifest names no Claude program.')

    const cwd = configDir
    const projectKey = projectKeyOf(cwd)
    const resume = restore === 'none' ? null : request.session?.sessionId
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
      saved: new Set(files.map(file => file.path)),
    })
  }

  async function* attempt(
    session: Live,
    mapper: Mapper,
    text: string
  ): AsyncGenerator<ReplyEvent, Outcome> {
    let heard = false

    try {
      for await (const message of session.send(text)) {
        heard = true

        if (message.type === 'result') return {result: message}

        yield* mapper.map(message)
      }

      return {error: 'Claude stopped before finishing this Reply.', heard}
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        heard,
      }
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
   * Sends the Prompt and streams Claude's answer, from the warm session
   * standing at the Reply answered, else a new `claude`. A warm one whose
   * `claude` exited while idle answers nothing, so a new one resumes in its
   * place. When the restore from the store doesn't get `claude` going, the
   * transcript is written back and it goes again from there.
   */
  async function* answer(
    request: ReplyRequest,
    mapper: Mapper
  ): AsyncGenerator<ReplyEvent, {session: Live; outcome: Outcome}> {
    const {text} = request.prompt
    const claimed = request.session && warm.claim(request.session)

    if (claimed) {
      const outcome = yield* attempt(claimed, mapper, text)

      if (!('error' in outcome) || outcome.heard || !claimed.ended) {
        return {session: claimed, outcome}
      }

      warm.drop(claimed)
    }

    const session = await open(request, request.session ? 'store' : 'none')
    warm.add(session)
    const outcome = yield* attempt(session, mapper, text)
    const refused = !session.started && session.restore === 'store'

    if (!refused || !request.session) return {session, outcome}

    warm.drop(session)

    const writtenBack = await writeTranscriptBack(deps.store, {
      configDir: request.vendor.configDir,
      projectKey: session.projectKey,
      sessionId: request.session.sessionId,
    })

    if (!writtenBack) return {session, outcome}

    const fallback = await open(request, 'file')
    warm.add(fallback)

    return {session: fallback, outcome: yield* attempt(fallback, mapper, text)}
  }

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    const {treeId, replyId} = request
    const ids = {treeId, replyId}
    const mapper = createReplyMapper(ids)

    yield {...ids, type: 'RUN_STARTED'}

    const {session, outcome} = yield* answer(request, mapper)

    if ('error' in outcome) {
      warm.drop(session)
      yield {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: {code: 'provider-error', message: outcome.error},
      }

      return
    }

    const finished = mapper.finished(outcome.result)
    const recorded = mapper.recorded()
    const {sessionId} = session

    if (finished.status !== 'complete') {
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

  return {startReply}
}
