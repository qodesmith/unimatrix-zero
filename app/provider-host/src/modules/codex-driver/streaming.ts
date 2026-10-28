import type {WhenIdle} from '#modules/idle/main'
import type {ContentEvent, Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {Notification, ParamsOf, RateLimits} from './wire'
import type {ReplyRequest, SignInRequest} from '@uz/contract/host'

import {createInbox} from '#modules/inbox/main'
import {ProgramCrashed, createReplyRuns} from '#modules/reply-runs/main'

import {createReplyMapper, threadOf, turnOf} from './replies'
import {folderOf, readRollouts, writeRolloutsBack} from './rollouts'

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
      writeRolloutsBack(configDir, await deps.store.loadFiles(folderOf(id)), {
        rewind,
      })
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

  /** Stop interrupts the turn once Codex has started it. */
  async function* send(
    running: Running,
    request: ReplyRequest,
    thread: LoadedThread,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Ending> {
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

  /** An app-server that exited while idle answers nothing: retry once. */
  async function* write(
    request: ReplyRequest,
    run: ReplyRun
  ): AsyncGenerator<ContentEvent, Ending> {
    for (let attempt = 1; ; attempt++) {
      const running = await claim(request.vendorProgram)
      let heard = false

      try {
        const thread = await threadFor(running, request)
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
