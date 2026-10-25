import type {SessionStoreClient} from '#modules/session-store/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {Notification, ParamsOf} from './wire'
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

/** The Model id that leaves the choice to Codex: the plan's default. */
export const DEFAULT_MODEL = 'default'

/** The app-server closes after this long without a Reply to write. */
export const IDLE_CLOSE_MS = 10 * 60 * 1000

const STOPPED_BEFORE_FINISHING = 'Codex stopped before finishing this Reply.'

/** Why a Reply failed, by the message of the error that ended it. */
function failureFrom(message: string): RunFailure {
  return message === STOPPED_BEFORE_FINISHING ||
    message === STOPPED_BEFORE_ANSWERING
    ? {code: 'program-crashed', message}
    : failureOf(message)
}

export interface CodexRepliesDeps {
  store: SessionStoreClient
  open: OpenAppServer
  idleMs: number
}

/** The app-server writing Replies, and the threads loaded in it. */
interface Running {
  server: AppServer
  threads: Map<string, LoadedThread>
  /** How many Replies it is writing. */
  writing: number
  idle: ReturnType<typeof setTimeout> | undefined
}

interface LoadedThread {
  id: string
  model: string
  /**
   * The turns this driver knows of it, oldest first: the one it was opened
   * at, then each one started here, whether it completed, stopped or failed.
   */
  turns: string[]
}

/** Where a Reply's turn is, for a stop to reach it. */
interface CodexTurn {
  server: AppServer
  threadId: string
  turnId: string
}

/**
 * A Reply being written: its turn once Codex has started it, and whether a
 * stop came before then, to pass on as soon as it has.
 */
interface Writing {
  turn: CodexTurn | null
  stopAsked: boolean
}

async function interrupt({server, threadId, turnId}: CodexTurn) {
  await server.request('turn/interrupt', {threadId, turnId})
}

/** Drops the turns after `messageId` from the thread, for a Retry. */
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

/**
 * ChatGPT's Replies through one `codex app-server`, which every Thread
 * shares: a Prompt continues its Codex thread where it is loaded, or else
 * resumes it from the app's own copy of its rollouts, or starts a new one.
 * A Prompt that starts a Branch forks the thread through the Reply it
 * answers, into a new thread; the thread the other Branch continues in is
 * left as it is. A Retry drops the turns after the Reply it answers from the
 * loaded thread first; a thread that isn't loaded resumes from the app's
 * copy, which ends at that Reply.
 */
export function createCodexReplies(deps: CodexRepliesDeps) {
  let current: Running | null = null
  let starting: Promise<Running> | null = null
  const writing = new Map<string, Writing>()

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

  function load(
    running: Running,
    opened: {thread: {id: string}; model: string},
    turns: string[]
  ): LoadedThread {
    const thread = {id: opened.thread.id, model: opened.model, turns}
    running.threads.set(thread.id, thread)

    return thread
  }

  /** The Codex thread the Prompt goes to, loaded in the app-server. */
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

  /** Sends the Prompt and streams Codex's answer, to its end. */
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

        const finished = mapper.finished(notification.params.turn)

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

  /**
   * Interrupts the Reply's turn; the stream then ends as `stopped`. A stop
   * before Codex has started the turn is passed on as soon as it has.
   */
  async function stop(replyId: string) {
    const entry = writing.get(replyId)

    if (!entry) return

    if (entry.turn) await interrupt(entry.turn)
    else entry.stopAsked = true
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
          error instanceof Error ? error.message : String(error)
        ),
      }
    } finally {
      writing.delete(request.replyId)
    }
  }

  return {startReply, stop}
}
