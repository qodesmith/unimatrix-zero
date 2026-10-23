import type {SessionStoreClient} from '#modules/session-store/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {Notification, ParamsOf} from './wire'
import type {
  ReplyRecorded,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {createInbox} from '#modules/inbox/main'

import {createReplyMapper, threadOf, turnOf} from './replies'
import {folderOf, readRollouts, writeRolloutsBack} from './rollouts'

/** The Model id that leaves the choice to Codex: the plan's default. */
export const DEFAULT_MODEL = 'default'

/** The app-server closes after this long without a Reply to write. */
export const IDLE_CLOSE_MS = 10 * 60 * 1000

export interface CodexRepliesDeps {
  store: SessionStoreClient
  open: OpenAppServer
  idleMs: number
}

/** The app-server writing Replies, and the threads loaded in it. */
interface Running {
  server: AppServer
  /** Each loaded thread's id, with the Model it runs. */
  threads: Map<string, string>
  /** How many Replies it is writing. */
  writing: number
  idle: ReturnType<typeof setTimeout> | undefined
}

interface OpenThread {
  id: string
  model: string
}

/**
 * ChatGPT's Replies through one `codex app-server`, which every Thread
 * shares: a Prompt continues its Codex thread where it is loaded, or else
 * resumes it from the app's own copy of its rollouts, or starts a new one.
 * A Prompt that starts a Branch forks the thread through the Reply it
 * answers, into a new thread; the thread the other Branch continues in is
 * left as it is.
 */
export function createCodexReplies(deps: CodexRepliesDeps) {
  let current: Running | null = null
  let starting: Promise<Running> | null = null

  async function forgetOnExit(running: Running) {
    await running.server.exited
    clearTimeout(running.idle)

    if (current === running) current = null
  }

  async function start(vendorProgram: SignInRequest) {
    const server = await deps.open(vendorProgram)

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

  /** The app-server, started if it isn't running, now writing a Reply. */
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

  /** The Codex thread the Prompt goes to, loaded in the app-server. */
  async function threadFor(
    running: Running,
    request: ReplyRequest
  ): Promise<OpenThread> {
    const {configDir} = request.vendorProgram

    const settings = {
      cwd: configDir,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      model: request.model === DEFAULT_MODEL ? null : request.model,
      developerInstructions: request.systemPrompt || null,
    } satisfies ParamsOf<'thread/start'>

    if (!request.session) {
      const {thread, model} = await running.server.request(
        'thread/start',
        settings
      )

      running.threads.set(thread.id, model)

      return {id: thread.id, model}
    }

    const {sessionId: id, messageId, fork} = request.session
    const loaded = running.threads.get(id)

    if (loaded && !fork) return {id, model: loaded}

    // Codex forks and resumes from the rollout on disk, which only a loaded
    // thread is sure to have written here.
    if (!loaded) {
      writeRolloutsBack(configDir, await deps.store.loadFiles(folderOf(id)))
    }

    if (fork) {
      const {thread, model} = await running.server.request('thread/fork', {
        threadId: id,
        lastTurnId: messageId,
        ...settings,
        excludeTurns: true,
      })

      running.threads.set(thread.id, model)

      return {id: thread.id, model}
    }

    const {model} = await running.server.request('thread/resume', {
      threadId: id,
      ...settings,
      excludeTurns: true,
    })

    running.threads.set(id, model)

    return {id, model}
  }

  /** Sends the Prompt and streams Codex's answer, to its end. */
  async function* send(
    running: Running,
    request: ReplyRequest,
    thread: OpenThread
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
    const ids = {treeId: request.treeId, replyId: request.replyId}
    const {server} = running
    const inbox = createInbox<Notification | {method: 'exited'}>()
    void server.exited.then(() => inbox.push({method: 'exited'}))

    const stop = server.listen(notification => {
      if (threadOf(notification) === thread.id) inbox.push(notification)
    })

    try {
      const started = await server.request('turn/start', {
        threadId: thread.id,
        input: [{type: 'text', text: request.prompt.text, text_elements: []}],
      })

      const turnId = started.turn.id
      const mapper = createReplyMapper(ids)

      for (;;) {
        const notification = await inbox.next()

        if (notification.method === 'exited') {
          throw new Error('Codex stopped before finishing this Reply.')
        }

        // Resuming repeats the last turn's token count, for instance.
        if (turnOf(notification) !== turnId) continue

        yield* mapper.map(notification)

        if (notification.method !== 'turn/completed') continue

        const finished = mapper.finished(notification.params.turn)

        if (finished.status === 'complete') {
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
      stop()
    }
  }

  /**
   * Writes the Reply in the running app-server. One that exited while idle
   * answers nothing, so a new one takes the Prompt in its place, once.
   */
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

    yield {...ids, type: 'RUN_STARTED'}

    try {
      yield* write(request)
    } catch (error) {
      yield {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: {
          code: 'provider-error',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  return {startReply}
}
