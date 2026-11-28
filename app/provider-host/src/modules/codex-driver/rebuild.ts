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
import {configOf, isSandboxed, loadThread} from './threads'

const SESSION_LOST = /no rollout found for thread id/

export interface Opened {
  thread: LoadedThread
  dropped: boolean
  replay: boolean
  rebuilt: boolean
}

export type Restored = Omit<Opened, 'replay' | 'rebuilt'>

/**
 * Supervised asks before every command and edit, and the app answers the
 * asking (ADR 0022). Its Sandbox is the profile in the thread's `config`: a
 * `sandbox` here would replace the profile. Where the profile can't run yet,
 * `workspace-write` holds instead (ADR 0018).
 */
function threadAccessOf(request: ReplyRequest, platform: NodeJS.Platform) {
  if (request.permissionMode === 'full-access') {
    return {sandbox: 'danger-full-access', approvalPolicy: 'never'} as const
  }

  return isSandboxed(request, platform)
    ? ({approvalPolicy: 'untrusted'} as const)
    : ({sandbox: 'workspace-write', approvalPolicy: 'untrusted'} as const)
}

function turnSandboxOf(
  request: ReplyRequest,
  platform: NodeJS.Platform
): Pick<ParamsOf<'turn/start'>, 'sandboxPolicy'> {
  if (request.permissionMode === 'full-access') {
    return {sandboxPolicy: {type: 'dangerFullAccess'}}
  }

  return isSandboxed(request, platform)
    ? {}
    : {
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [request.treeFolder],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      }
}

/**
 * The same access for one turn, which holds for its thread from then on. A
 * `sandboxPolicy` replaces the thread's profile for good, so a sandboxed turn
 * sends none: its thread was loaded with the profile.
 */
export function turnAccessOf(request: ReplyRequest, platform: NodeJS.Platform) {
  return {
    cwd: request.treeFolder,
    approvalPolicy: threadAccessOf(request, platform).approvalPolicy,
    ...turnSandboxOf(request, platform),
  } satisfies Omit<ParamsOf<'turn/start'>, 'threadId' | 'input'>
}

export function settingsOf(request: ReplyRequest, platform: NodeJS.Platform) {
  return {
    cwd: request.treeFolder,
    ...threadAccessOf(request, platform),
    model: request.model,
    developerInstructions:
      explainingLabels(request.systemPrompt, request.thread) || null,
  } satisfies ParamsOf<'thread/start'>
}

export interface Opening {
  server: Pick<AppServer, 'request'>
  threads: Map<string, LoadedThread>
  platform: NodeJS.Platform
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
  {server, threads, platform}: Opening,
  request: ReplyRequest
): Promise<Opened> {
  const settings = settingsOf(request, platform)
  const config = configOf(request, platform)
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

export async function resumeForCut(
  {server, threads}: Omit<Opening, 'platform'>,
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
