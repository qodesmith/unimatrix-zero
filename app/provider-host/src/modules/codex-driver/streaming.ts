import type {WhenIdle} from '#modules/idle/main'
import type {
  ContentEvent,
  Ending,
  ReplyRun,
  WriteReplyEvent,
} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {Notification, ParamsOf, RateLimits, ResponseOf} from './wire'
import type {
  PromptRecorded,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'

import {createInbox} from '#modules/inbox/main'
import {ProgramCrashed, createReplyRuns} from '#modules/reply-runs/main'

import {createReplyMapper, threadOf, turnOf} from './replies'
import {folderOf, readRollouts, rolloutAt, writeRolloutsBack} from './rollouts'

/** The Model id that leaves the choice to Codex. */
export const DEFAULT_MODEL = 'default'

export const IDLE_CLOSE_MS = 10 * 60 * 1000

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
  whenIdle: WhenIdle
}

interface Running {
  server: AppServer
  threads: Map<string, LoadedThread>
  writing: number
  /** Calls off the idle close. */
  wake: (() => void) | undefined
}

interface LoadedThread {
  id: string
  model: string
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
  /** Its rollout, which a revert leaves for a new one. */
  path: string | null
}

/** ChatGPT's Replies through one `codex app-server` that every Thread shares. */
export function createCodexReplies(deps: CodexRepliesDeps) {
  let current: Running | null = null
  let starting: Promise<Running> | null = null
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
    running.wake?.()

    if (current === running) current = null
  }

  async function start(vendorProgram: SignInRequest) {
    const server = await deps.open(vendorProgram)
    server.listen(onRateLimits)

    const running: Running = {
      server,
      threads: new Map(),
      writing: 0,
      wake: undefined,
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

    running.wake?.()
    running.writing += 1

    return running
  }

  function release(running: Running) {
    running.writing -= 1

    if (running.writing > 0) return

    running.wake = deps.whenIdle(() => {
      if (current === running) current = null

      void running.server.close()
    })
  }

  async function holdsTurn(running: Running, threadId: string, turnId: string) {
    let cursor: string | null = null

    do {
      const page: ResponseOf<'thread/turns/list'> =
        await running.server.request('thread/turns/list', {
          threadId,
          cursor,
          itemsView: 'notLoaded',
        })

      if (page.data.some(turn => turn.id === turnId)) return true

      cursor = page.nextCursor
    } while (cursor !== null)

    return false
  }

  /** Null when Codex no longer has `beforeTurnId`, so nothing is left to drop. */
  async function requestRevert(
    running: Running,
    threadId: string,
    beforeTurnId: string
  ) {
    try {
      return await running.server.request('thread/revert', {
        threadId,
        beforeTurnId,
      })
    } catch (error) {
      if (running.server.hasExited) throw error

      if (await holdsTurn(running, threadId, beforeTurnId)) throw error

      return null
    }
  }

  /**
   * Drops `beforeTurnId` and every turn after it. The new rollout points into
   * the old one, maybe past the app's copy, so the old one is saved again.
   */
  async function revert(
    running: Running,
    thread: LoadedThread,
    beforeTurnId: string,
    configDir: string
  ) {
    const answer = await requestRevert(running, thread.id, beforeTurnId)

    if (answer) {
      const old =
        thread.path === null ? null : rolloutAt(configDir, thread.path)

      if (old) await deps.store.saveFiles(folderOf(thread.id), [old])

      thread.path = answer.thread.path
    }

    const at = thread.turns.indexOf(beforeTurnId)

    if (at !== -1) thread.turns.length = at
  }

  async function dropAfter(
    running: Running,
    thread: LoadedThread,
    messageId: string | null,
    configDir: string
  ) {
    const at = messageId === null ? -1 : thread.turns.indexOf(messageId)
    const next = at === -1 ? undefined : thread.turns[at + 1]

    if (next !== undefined) await revert(running, thread, next, configDir)
  }

  function load(
    running: Running,
    opened: {thread: {id: string; path: string | null}; model: string},
    turns: string[]
  ): LoadedThread {
    const thread = {
      id: opened.thread.id,
      model: opened.model,
      turns,
      path: opened.thread.path,
    }

    running.threads.set(thread.id, thread)

    return thread
  }

  async function threadFor(
    running: Running,
    request: ReplyRequest,
    dropFrom: string | null
  ): Promise<{thread: LoadedThread; dropped: boolean}> {
    const {configDir} = request.vendorProgram

    const settings = {
      cwd: configDir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: request.model === DEFAULT_MODEL ? null : request.model,
      developerInstructions: request.systemPrompt || null,
    } satisfies ParamsOf<'thread/start'>

    if (!request.session) {
      const thread = load(
        running,
        await running.server.request('thread/start', settings),
        []
      )

      return {thread, dropped: false}
    }

    const {sessionId: id, messageId, type} = request.session
    const fork = type === 'fork'
    const rewind = type === 'rewind'
    const loaded = running.threads.get(id)
    const openedAt = messageId === null ? [] : [messageId]

    async function cut(thread: LoadedThread) {
      if (dropFrom === null) return {thread, dropped: false}

      await revert(running, thread, dropFrom, configDir)

      return {thread, dropped: true}
    }

    if (loaded && !fork) {
      if (!rewind) return cut(loaded)

      await dropAfter(running, loaded, messageId, configDir)

      return {thread: loaded, dropped: false}
    }

    // Codex forks and resumes from the rollout on disk, which only a loaded
    // thread is sure to have written here.
    if (!loaded) {
      writeRolloutsBack(configDir, await deps.store.loadFiles(folderOf(id)), {
        rewind,
      })
    }

    if (fork) {
      const thread = load(
        running,
        await running.server.request('thread/fork', {
          threadId: id,
          lastTurnId: messageId,
          ...settings,
          excludeTurns: true,
        }),
        openedAt
      )

      return {thread, dropped: false}
    }

    const resumed = load(
      running,
      await running.server.request('thread/resume', {
        threadId: id,
        ...settings,
        excludeTurns: true,
      }),
      openedAt
    )

    // The rollout on disk was kept: it holds the Reply cut short.
    return cut(resumed)
  }

  /** Stop interrupts the turn once Codex has started it. */
  async function* send(
    running: Running,
    request: ReplyRequest,
    thread: LoadedThread,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent | PromptRecorded, Ending> {
    const ids = {treeId: request.treeId, replyId: request.replyId}
    const {server} = running
    const inbox = createInbox<Notification | {method: 'exited'}>()
    void server.exited.then(() => inbox.push({method: 'exited'}))

    const unlisten = server.listen(notification => {
      if (threadOf(notification) === thread.id) inbox.push(notification)
    })

    let unstoppable: (() => void) | null = null

    try {
      const started = await server.request('turn/start', {
        threadId: thread.id,
        input: [{type: 'text', text: request.prompt.text, text_elements: []}],
      })

      const turnId = started.turn.id
      thread.turns.push(turnId)

      // Codex has the turn on disk by now; a Retry reverts before it.
      yield {
        ...ids,
        type: 'PROMPT_RECORDED',
        session: {sessionId: thread.id, messageId: turnId},
      }

      unstoppable = run.stoppable(async () => {
        await server.request('turn/interrupt', {threadId: thread.id, turnId})
      })

      const mapper = createReplyMapper(ids)

      for (;;) {
        const notification = await inbox.next()

        if (notification.method === 'exited') {
          throw new ProgramCrashed('Codex stopped before finishing this Reply.')
        }

        // Resuming repeats the last turn's token count, for instance.
        if (turnOf(notification) !== turnId) continue

        yield* mapper.map(notification)

        if (notification.method !== 'turn/completed') continue

        const finished = mapper.finished(
          notification.params.turn,
          limitLifts(limits)
        )

        if (finished.status === 'failed') return {finished}

        // A stopped turn stays in the thread as a completed one does.
        const {configDir} = request.vendorProgram
        const files = await readRollouts(server, configDir, thread.id)
        await deps.store.saveFiles(folderOf(thread.id), files)

        return {
          finished,
          recorded: {
            ...ids,
            type: 'REPLY_RECORDED',
            model: thread.model,
            session: {sessionId: thread.id, messageId: turnId},
          },
        }
      }
    } finally {
      unstoppable?.()
      unlisten()
    }
  }

  /**
   * An app-server that exited while idle answers nothing: try once more on a
   * new one. Codex keeps a cut on disk, so the second attempt doesn't cut
   * again.
   */
  async function* write(
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<WriteReplyEvent, Ending> {
    const {session} = request
    let dropFrom = session?.type === 'cut' ? session.dropFrom : null

    for (let attempt = 1; ; attempt++) {
      const running = await claim(request.vendorProgram)
      let heard = false

      try {
        const {thread, dropped} = await threadFor(running, request, dropFrom)

        if (dropped) {
          dropFrom = null
          yield {
            type: 'PROMPT_DROPPED',
            treeId: request.treeId,
            replyId: request.replyId,
          }
        }

        const sent = send(running, request, thread, run)

        for (;;) {
          const step = await sent.next()

          if (step.done) return step.value

          heard = true
          yield step.value
        }
      } catch (error) {
        if (heard || attempt === 2 || !running.server.hasExited) throw error

        if (current === running) current = null
      } finally {
        release(running)
      }
    }
  }

  return createReplyRuns(write, {limitLifts: () => limitLifts(limits)})
}
