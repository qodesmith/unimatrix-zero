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

/** The ops main answers with an error, and the error's message. */
type Refusals = Partial<Record<SessionStoreRequest['op'], string>>

/**
 * Main's side of the session store, in memory for tests: entries deduplicated
 * on `uuid`, and answers a tick later, as from main.
 */
export function fakeStore(refuses: Refusals = {}) {
  const entries = new Map<string, SessionEntry[]>()
  const files = new Map<string, Map<string, SessionFile>>()
  const asked: SessionStoreRequest['op'][] = []

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
    switch (request.op) {
      case 'append':
        append(request.key, request.entries)

        return null
      case 'load':
        return entries.get(keyText(request.key)) ?? null
      case 'list-subkeys':
        return subkeys(request.projectKey, request.sessionId)
      case 'load-files':
        return [...filesOf(request.projectKey, request.sessionId).values()]
      case 'save-files': {
        const kept = filesOf(request.projectKey, request.sessionId)

        for (const file of request.files) kept.set(file.path, file)

        return null
      }

      default:
        throw new Error('Unknown session store request.')
    }
  }

  const client = createSessionStoreClient(message => {
    if (message.type !== 'SESSION_STORE') return

    asked.push(message.request.op)
    const refused = refuses[message.request.op]

    setTimeout(() => {
      client.settle(
        message.requestId,
        refused === undefined
          ? {ok: true, value: answer(message.request)}
          : {ok: false, message: refused}
      )
    }, 0)
  })

  return {
    client,
    /** Each op asked so far, oldest first. */
    asked,
    entriesOf(projectKey: string, sessionId: string) {
      return entries.get(keyText({projectKey, sessionId})) ?? []
    },
    filesOf,
  }
}
