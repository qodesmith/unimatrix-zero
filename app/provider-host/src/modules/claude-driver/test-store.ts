import type {
  SessionEntry,
  SessionFile,
  SessionKey,
  SessionStoreRequest,
  SessionStoreValue,
} from '@uz/contract/host'

import {createSessionStoreClient} from '#modules/session-store/main'

function keyText({projectKey, sessionId, subpath}: SessionKey) {
  return [projectKey, sessionId, subpath ?? ''].join('\n')
}

/**
 * Main's side of the session store, kept in memory for tests: entries in
 * order, deduplicated on `uuid`, and files by path. Answers come back a tick
 * later, as they would from main.
 */
export function fakeStore() {
  const entries = new Map<string, SessionEntry[]>()
  const files = new Map<string, Map<string, SessionFile>>()

  function filesOf(projectKey: string, sessionId: string) {
    const key = keyText({projectKey, sessionId})
    const kept = files.get(key) ?? new Map<string, SessionFile>()
    files.set(key, kept)

    return kept
  }

  function append(key: SessionKey, added: SessionEntry[]) {
    const kept = entries.get(keyText(key)) ?? []
    const uuids = new Set(kept.map(entry => entry.uuid))

    for (const entry of added) {
      if (entry.uuid === undefined || !uuids.has(entry.uuid)) kept.push(entry)
    }

    entries.set(keyText(key), kept)
  }

  function subkeys(projectKey: string, sessionId: string) {
    return [...entries.keys()].flatMap(key => {
      const [project, session, subpath = ''] = key.split('\n')

      return project === projectKey && session === sessionId && subpath !== ''
        ? [subpath]
        : []
    })
  }

  function answer(request: SessionStoreRequest): SessionStoreValue {
    const {op} = request

    if (op === 'append') {
      append(request.key, request.entries)

      return null
    }

    if (op === 'load') return entries.get(keyText(request.key)) ?? null

    if (op === 'list-subkeys') {
      return subkeys(request.projectKey, request.sessionId)
    }

    const kept = filesOf(request.projectKey, request.sessionId)

    if (op === 'load-files') return [...kept.values()]

    for (const file of request.files) kept.set(file.path, file)

    return null
  }

  const client = createSessionStoreClient(message => {
    if (message.type !== 'SESSION_STORE') return

    setTimeout(() => {
      client.settle(message.requestId, {
        ok: true,
        value: answer(message.request),
      })
    }, 0)
  })

  return {
    client,
    /** The entries kept for a session's own transcript. */
    entriesOf(projectKey: string, sessionId: string) {
      return entries.get(keyText({projectKey, sessionId})) ?? []
    },
    filesOf,
  }
}
