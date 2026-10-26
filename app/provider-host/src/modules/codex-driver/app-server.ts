import type {Method, Notification, ParamsOf, ResponseOf} from './wire'
import type {SignInRequest} from '@uz/contract/host'
import type {EventEmitter} from 'node:events'
import type {Readable, Writable} from 'node:stream'
import type {z} from 'zod'

import {ProgramCrashed} from '#modules/reply-runs/main'
import {once} from 'node:events'
import {createInterface} from 'node:readline'
import {setTimeout as delay} from 'node:timers/promises'

import {
  AnswerSchema,
  NotificationSchema,
  RESPONSES,
  ServerRequestSchema,
} from './wire'

const CLOSE_TIMEOUT_MS = 10_000

const STOPPED_BEFORE_ANSWERING = 'Codex stopped before it answered.'

export interface CodexCommand {
  command: string
  args: string[]
}

export interface CodexProcess extends EventEmitter {
  stdin: Writable
  stdout: Readable
  kill(): boolean
}

export type SpawnCodex = (
  command: CodexCommand,
  options: {cwd: string; env: Record<string, string>}
) => CodexProcess

type Answer = z.infer<typeof AnswerSchema>

interface Pending {
  resolve: (answer: Answer) => void
  reject: (error: Error) => void
}

type Outgoing =
  | {id: number; method: Method; params: unknown}
  | {method: 'initialized'}
  | {id: Answer['id'] | string; error: {code: number; message: string}}

/** `codex app-server` over stdio: an object per line, no `jsonrpc` field. */
export interface AppServer {
  request<M extends Method>(
    method: M,
    params: ParamsOf<M>
  ): Promise<ResponseOf<M>>
  listen(listener: (notification: Notification) => void): () => void
  readonly exited: Promise<void>
  readonly hasExited: boolean
  /** Ends `codex`'s input and waits for it to exit, killing it if stuck. */
  close(): Promise<void>
}

function resultOf<M extends Method>(method: M, answer: Answer): ResponseOf<M> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caller-typed lookup: RESPONSES[method] parses exactly ResponseOf<M>
  return RESPONSES[method].parse(answer.result) as ResponseOf<M>
}

export type OpenAppServer = (vendorProgram: SignInRequest) => Promise<AppServer>

/** Starts `codex app-server` and introduces the app to it. */
export async function startAppServer(
  spawn: SpawnCodex,
  command: CodexCommand,
  options: {cwd: string; env: Record<string, string>}
): Promise<AppServer> {
  const child = spawn(command, options)
  const pending = new Map<number, Pending>()
  const listeners = new Set<(notification: Notification) => void>()
  let nextId = 1
  let hasExited = false

  const exited = once(child, 'exit').then(
    () => undefined,
    () => undefined
  )

  // A program that can't start reports an error and never exits.
  const failed = once(child, 'error').then(
    () => undefined,
    () => undefined
  )

  async function end() {
    await Promise.race([exited, failed])
    hasExited = true

    for (const waiting of pending.values()) {
      waiting.reject(new ProgramCrashed(STOPPED_BEFORE_ANSWERING))
    }

    pending.clear()
  }

  const ended = end()

  function write(message: Outgoing) {
    if (!hasExited) child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  function onLine(line: string) {
    let json: unknown

    try {
      json = JSON.parse(line)
    } catch {
      return
    }

    const asked = ServerRequestSchema.safeParse(json)

    if (asked.success) {
      // Nothing the app turns on asks the app anything.
      write({
        id: asked.data.id,
        error: {code: -32_601, message: 'Unimatrix Zero can’t answer this.'},
      })

      return
    }

    const answer = AnswerSchema.safeParse(json)

    if (answer.success) {
      const {id, error} = answer.data
      const waiting = pending.get(id)
      pending.delete(id)

      if (error) waiting?.reject(new Error(error.message))
      else waiting?.resolve(answer.data)

      return
    }

    const notification = NotificationSchema.safeParse(json)

    if (notification.success) {
      for (const listener of listeners) listener(notification.data)
    }
  }

  createInterface({input: child.stdout}).on('line', onLine)
  child.stdin.on('error', () => undefined)

  async function request<M extends Method>(
    method: M,
    params: ParamsOf<M>
  ): Promise<ResponseOf<M>> {
    if (hasExited) throw new Error('Codex isn’t running.')

    const id = nextId++
    const {promise, resolve, reject} = Promise.withResolvers<Answer>()

    pending.set(id, {resolve, reject})
    write({id, method, params})

    return resultOf(method, await promise)
  }

  const server: AppServer = {
    request,

    listen(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },

    exited: ended,

    get hasExited() {
      return hasExited
    },

    async close() {
      if (hasExited) return

      child.stdin.end()

      const stuck = new AbortController()

      const finished = await Promise.race([
        ended.then(() => true),
        delay(CLOSE_TIMEOUT_MS, false, {signal: stuck.signal}).catch(
          () => false
        ),
      ])

      stuck.abort()

      if (!finished) child.kill()

      await ended
    },
  }

  await request('initialize', {
    clientInfo: {
      name: 'unimatrix_zero',
      title: 'Unimatrix Zero',
      version: '0.0.0',
    },
    capabilities: null,
  })
  write({method: 'initialized'})

  return server
}
