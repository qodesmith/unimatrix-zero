import type {AppServer} from './app-server'
import type {ResponseItem} from './protocol/ResponseItem'
import type {LoadedThread} from './threads'
import type {ParamsOf} from './wire'
import type {
  DeletionCut,
  ReplyRequest,
  SessionFile,
  Thread,
} from '@uz/contract/host'

import {RequestRefused} from '#modules/failures/main'
import {earlierPrompted} from '#modules/prompt-content/main'
import {explainingLabels, replyText} from '#modules/thread-replay/main'

import {messageContent, read} from './input'
import {writeRolloutsBack} from './rollouts'
import {configOf, loadThread} from './threads'

const SESSION_LOST = /no rollout found for thread id/

/**
 * `replay`: the thread holds nothing of the Thread, so the Prompt tells it.
 * `rebuilt`: the thread was started and given the Thread.
 */
export interface Opened {
  thread: LoadedThread
  dropped: boolean
  replay: boolean
  rebuilt: boolean
}

export type Restored = Omit<Opened, 'replay' | 'rebuilt'>

/**
 * Supervised writes only in the Tree's folder, and asks before every command
 * and edit; the app answers the asking (ADR 0022).
 */
function threadAccessOf({permissionMode}: ReplyRequest) {
  return permissionMode === 'full-access'
    ? ({sandbox: 'danger-full-access', approvalPolicy: 'never'} as const)
    : ({sandbox: 'workspace-write', approvalPolicy: 'untrusted'} as const)
}

/** The same access for one turn, which holds for its thread from then on. */
export function turnAccessOf(request: ReplyRequest) {
  return {
    cwd: request.treeFolder,
    approvalPolicy: threadAccessOf(request).approvalPolicy,
    sandboxPolicy:
      request.permissionMode === 'full-access'
        ? {type: 'dangerFullAccess'}
        : {
            type: 'workspaceWrite',
            writableRoots: [request.treeFolder],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          },
  } satisfies Omit<ParamsOf<'turn/start'>, 'threadId' | 'input'>
}

export function settingsOf(request: ReplyRequest) {
  return {
    cwd: request.treeFolder,
    ...threadAccessOf(request),
    model: request.model,
    developerInstructions:
      explainingLabels(request.systemPrompt, request.thread) || null,
  } satisfies ParamsOf<'thread/start'>
}

export interface Opening {
  server: Pick<AppServer, 'request'>
  threads: Map<string, LoadedThread>
}

function replied(text: string) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{type: 'output_text', text}],
  } satisfies ResponseItem
}

async function itemsOf(thread: Thread) {
  const turns = await Promise.all(
    thread.map(async exchange => {
      const reply = replyText(exchange)

      const prompt = {
        type: 'message',
        role: 'user',
        content: messageContent(
          await read(
            earlierPrompted({
              text: exchange.prompt,
              attachments: exchange.attachments,
            })
          )
        ),
      } satisfies ResponseItem

      return [prompt, ...(reply === '' ? [] : [replied(reply)])]
    })
  )

  return turns.flat()
}

/** False when Codex refuses the items, which leaves a text replay. */
async function injectThread(
  server: Opening['server'],
  threadId: string,
  items: Awaited<ReturnType<typeof itemsOf>>
) {
  try {
    await server.request('thread/inject_items', {threadId, items})

    return true
  } catch (error) {
    if (!(error instanceof RequestRefused)) throw error

    return false
  }
}

async function newThread(
  {server, threads}: Opening,
  request: ReplyRequest
): Promise<Opened> {
  const settings = settingsOf(request)
  const config = configOf(request)
  // Before the thread starts, so a failure leaves none behind.
  const items = await itemsOf(request.thread)

  async function open() {
    return loadThread(
      threads,
      await server.request('thread/start', {...settings, config}),
      [],
      config
    )
  }

  const thread = await open()

  if (request.thread.length === 0) {
    return {thread, dropped: false, replay: false, rebuilt: false}
  }

  if (await injectThread(server, thread.id, items)) {
    return {thread, dropped: false, replay: false, rebuilt: true}
  }

  threads.delete(thread.id)

  return {thread: await open(), dropped: false, replay: true, rebuilt: true}
}

/**
 * The one way a session is rebuilt from its Thread (ADR 0001): `restore` from
 * the app's copy first, else a new thread. Null `restore`: no session exists.
 */
export async function openThread(
  opening: Opening,
  request: ReplyRequest,
  restore: (() => Promise<Restored>) | null
): Promise<Opened> {
  if (!restore) return newThread(opening, request)

  try {
    return {...(await restore()), replay: false, rebuilt: false}
  } catch (error) {
    const lost =
      error instanceof RequestRefused && SESSION_LOST.test(error.message)

    if (request.thread.length === 0 || !lost) throw error

    return newThread(opening, request)
  }
}

/** A deletion cut loads its thread read-only in the config folder. */
export async function resumeForCut(
  {server, threads}: Opening,
  {sessionId: id, messageId}: DeletionCut,
  configDir: string,
  files: SessionFile[]
) {
  writeRolloutsBack(configDir, files, {rewind: false})

  const opened = await server.request('thread/resume', {
    threadId: id,
    cwd: configDir,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    config: {},
    excludeTurns: true,
  })

  return loadThread(
    threads,
    opened,
    messageId === null ? [] : [messageId],
    null
  )
}
