import type {SessionStoreClient} from '#modules/session-store/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {Notification, ParamsOf, RateLimits} from './wire'
import type {
  ReplyRecorded,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'
import type {ReplyEvent, RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'
import {createInbox} from '#modules/inbox/main'

import {STOPPED_BEFORE_ANSWERING} from './app-server'
import {createReplyMapper, threadOf, turnOf} from './replies'
import {folderOf, readRollouts, writeRolloutsBack} from './rollouts'

/** The Model id that leaves the choice to Codex. */
export const DEFAULT_MODEL = 'default'

export const IDLE_CLOSE_MS = 10 * 60 * 1000

const STOPPED_BEFORE_FINISHING = 'Codex stopped before finishing this Reply.'

function failureFrom(message: string, resetsAt?: number): RunFailure {
  return message === STOPPED_BEFORE_FINISHING ||
    message === STOPPED_BEFORE_ANSWERING
    ? {code: 'program-crashed', message}
    : failureOf(message, resetsAt)
}

/** When all full windows lift, in seconds since the epoch; else undefined. */
function limitLifts({primary, secondary}: RateLimits) {
  const now = Date.now() / 1000

  const lifts = [primary, secondary].flatMap(window =>
    window !== null &&
    window.usedPercent >= 100 &&
    window.resetsAt !== null &&
    window.resetsAt > now
      ? [window.resetsAt]
      : []
  )

  return lifts.length === 0 ? undefined : Math.max(...lifts)
}

export interface CodexRepliesDeps {
  store: SessionStoreClient
  open: OpenAppServer
  idleMs: number
}

interface Running {
  server: AppServer
  threads: Map<string, LoadedThread>
  writing: number
  idle: ReturnType<typeof setTimeout> | undefined
}

interface LoadedThread {
  id: string
  model: string
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
}

interface CodexTurn {
  server: AppServer
  threadId: string
  turnId: string
}

interface Writing {
  turn: CodexTurn | null
  stopAsked: boolean
}

async function interrupt({server, threadId, turnId}: CodexTurn) {
  await server.request('turn/interrupt', {threadId, turnId})
}

async function dropAfter(
  server: AppServer,
  thread: LoadedThread,
  messageId: string | null
) {
  const at = messageId === null ? -1 : thread.turns.indexOf(messageId)
  const next = at === -1 ? undefined : thread.turns[at + 1]

  if (next === undefined) return

  await server.request('thread/revert', {
    threadId: thread.id,
    beforeTurnId: next,
  })

  thread.turns.length = at + 1
}

/** ChatGPT's Replies through one `codex app-server` that every Thread shares. */
export function createCodexReplies(deps: CodexRepliesDeps) {
  let current: Running | null = null
  let starting: Promise<Running> | null = null
  const writing = new Map<string, Writing>()
  let limits: RateLimits = {primary: null, secondary: null}

  function onRateLimits(notification: Notification) {
    if (notification.method !== 'account/rateLimits/updated') return

    const {primary, secondary} = notification.params.rateLimits

    limits = {
      primary: primary ?? limits.primary,
      secondary: secondary ?? limits.secondary,
    }
  }

  async function forgetOnExit(running: Running) {
    await running.server.exited
    clearTimeout(running.idle)

    if (current === running) current = null
  }

  async function start(vendorProgram: SignInRequest) {
    const server = await deps.open(vendorProgram)
    server.listen(onRateLimits)

    const running: Running = {
      server,
      threads: new Map(),
      writing: 0,
      idle: undefined,
    }

    void forgetOnExit(running)

    current = running

    return running
  }

  async function claim(vendorProgram: SignInRequest) {
    const running =
      current ??
      (await (starting ??= start(vendorProgram).finally(() => {
        starting = null
      })))

    clearTimeout(running.idle)
    running.writing += 1

    return running
  }

  function release(running: Running) {
    running.writing -= 1

    if (running.writing > 0) return

    running.idle = setTimeout(() => {
      if (current === running) current = null

      void running.server.close()
    }, deps.idleMs)
  }

  function load(
    running: Running,
    opened: {thread: {id: string}; model: string},
    turns: string[]
  ): LoadedThread {
    const thread = {id: opened.thread.id, model: opened.model, turns}
    running.threads.set(thread.id, thread)

    return thread
  }

  async function threadFor(
    running: Running,
    request: ReplyRequest
  ): Promise<LoadedThread> {
    const {configDir} = request.vendorProgram

    const settings = {
      cwd: configDir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: request.model === DEFAULT_MODEL ? null : request.model,
      developerInstructions: request.systemPrompt || null,
    } satisfies ParamsOf<'thread/start'>

    if (!request.session) {
      return load(
        running,
        await running.server.request('thread/start', settings),
        []
      )
    }

    const {sessionId: id, messageId, fork, rewind} = request.session
    const loaded = running.threads.get(id)
    const openedAt = messageId === null ? [] : [messageId]

    if (loaded && !fork) {
      if (rewind) await dropAfter(running.server, loaded, messageId)

      return loaded
    }

    // Codex forks and resumes from the rollout on disk, which only a loaded
    // thread is sure to have written here.
    if (!loaded) {
      writeRolloutsBack(configDir, await deps.store.loadFiles(folderOf(id)))
    }

    if (fork) {
      return load(
        running,
        await running.server.request('thread/fork', {
          threadId: id,
          lastTurnId: messageId,
          ...settings,
          excludeTurns: true,
        }),
        openedAt
      )
    }

    return load(
      running,
      await running.server.request('thread/resume', {
        threadId: id,
        ...settings,
        excludeTurns: true,
      }),
      openedAt
    )
  }

  async function* send(
    running: Running,
    request: ReplyRequest,
    thread: LoadedThread
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    const ids = {treeId: request.treeId, replyId: request.replyId}
    const {server} = running
    const inbox = createInbox<Notification | {method: 'exited'}>()
    void server.exited.then(() => inbox.push({method: 'exited'}))

    const unlisten = server.listen(notification => {
      if (threadOf(notification) === thread.id) inbox.push(notification)
    })

    try {
      const started = await server.request('turn/start', {
        threadId: thread.id,
        input: [{type: 'text', text: request.prompt.text, text_elements: []}],
      })

      const turnId = started.turn.id
      thread.turns.push(turnId)
      const entry = writing.get(request.replyId)

      if (entry) {
        entry.turn = {server, threadId: thread.id, turnId}

        if (entry.stopAsked) void interrupt(entry.turn).catch(() => undefined)
      }

      const mapper = createReplyMapper(ids)

      for (;;) {
        const notification = await inbox.next()

        if (notification.method === 'exited') {
          throw new Error(STOPPED_BEFORE_FINISHING)
        }

        // Resuming repeats the last turn's token count, for instance.
        if (turnOf(notification) !== turnId) continue

        yield* mapper.map(notification)

        if (notification.method !== 'turn/completed') continue

        const finished = mapper.finished(
          notification.params.turn,
          limitLifts(limits)
        )

        // A stopped turn stays in the thread as a completed one does.
        if (finished.status !== 'failed') {
          const {configDir} = request.vendorProgram
          const files = await readRollouts(server, configDir, thread.id)
          await deps.store.saveFiles(folderOf(thread.id), files)

          yield {
            ...ids,
            type: 'REPLY_RECORDED',
            model: thread.model,
            session: {sessionId: thread.id, messageId: turnId},
          }
        }

        yield finished

        return
      }
    } finally {
      const entry = writing.get(request.replyId)

      if (entry) entry.turn = null

      unlisten()
    }
  }

  /** Interrupts the Reply's turn; the stream then ends as `stopped`. */
  async function stop(replyId: string) {
    const entry = writing.get(replyId)

    if (!entry) return

    if (entry.turn) await interrupt(entry.turn)
    else entry.stopAsked = true
  }

  /** An app-server that exited while idle answers nothing: retry once. */
  async function* write(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    for (let attempt = 1; ; attempt++) {
      const running = await claim(request.vendorProgram)
      let heard = false

      try {
        const thread = await threadFor(running, request)

        for await (const event of send(running, request, thread)) {
          heard = true
          yield event
        }

        return
      } catch (error) {
        if (heard || attempt === 2 || !running.server.hasExited) throw error

        if (current === running) current = null
      } finally {
        release(running)
      }
    }
  }

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    const ids = {treeId: request.treeId, replyId: request.replyId}
    writing.set(request.replyId, {turn: null, stopAsked: false})

    yield {...ids, type: 'RUN_STARTED'}

    try {
      yield* write(request)
    } catch (error) {
      yield {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: failureFrom(
          error instanceof Error ? error.message : String(error),
          limitLifts(limits)
        ),
      }
    } finally {
      writing.delete(request.replyId)
    }
  }

  return {startReply, stop}
}
