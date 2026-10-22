import type {
  HostMessage,
  SessionEntry,
  SessionFile,
  SessionKey,
  SessionStoreRequest,
  SessionStoreValue,
} from '@uz/contract/host'

import {SESSION_STORE_RESULTS} from '@uz/contract/host'
import {randomUUID} from 'node:crypto'

type Outcome =
  | {ok: true; value: SessionStoreValue}
  | {ok: false; message: string}

interface Pending {
  resolve: (value: SessionStoreValue) => void
  reject: (error: Error) => void
}

export interface SessionFolder {
  projectKey: string
  sessionId: string
}

/**
 * The host's way to the app's copy of its sessions, which main keeps in the
 * database: each request is posted to main, and its promise settles with
 * main's answer.
 */
export function createSessionStoreClient(post: (message: HostMessage) => void) {
  const pending = new Map<string, Pending>()

  async function ask(request: SessionStoreRequest) {
    const requestId = randomUUID()

    const {promise, resolve, reject} =
      Promise.withResolvers<SessionStoreValue>()

    pending.set(requestId, {resolve, reject})
    post({type: 'SESSION_STORE', requestId, request})

    return promise
  }

  return {
    async append(key: SessionKey, entries: SessionEntry[]) {
      SESSION_STORE_RESULTS.append.parse(
        await ask({op: 'append', key, entries})
      )
    },

    /** Null when nothing was ever kept for the key. */
    async load(key: SessionKey) {
      return SESSION_STORE_RESULTS.load.parse(await ask({op: 'load', key}))
    },

    async listSubkeys(folder: SessionFolder) {
      return SESSION_STORE_RESULTS['list-subkeys'].parse(
        await ask({op: 'list-subkeys', ...folder})
      )
    },

    async saveFiles(folder: SessionFolder, files: SessionFile[]) {
      SESSION_STORE_RESULTS['save-files'].parse(
        await ask({op: 'save-files', ...folder, files})
      )
    },

    async loadFiles(folder: SessionFolder) {
      return SESSION_STORE_RESULTS['load-files'].parse(
        await ask({op: 'load-files', ...folder})
      )
    },

    /** Main answered; an answer to nothing pending is dropped. */
    settle(requestId: string, outcome: Outcome) {
      const waiting = pending.get(requestId)

      if (!waiting) return

      pending.delete(requestId)

      if (outcome.ok) waiting.resolve(outcome.value)
      else waiting.reject(new Error(outcome.message))
    },
  }
}

export type SessionStoreClient = ReturnType<typeof createSessionStoreClient>
