import type {AppServer} from './app-server'
import type {ResponseOf} from './wire'

async function holdsTurn(server: AppServer, threadId: string, turnId: string) {
  let cursor: string | null = null

  do {
    const page: ResponseOf<'thread/turns/list'> = await server.request(
      'thread/turns/list',
      {threadId, cursor, itemsView: 'notLoaded'}
    )

    if (page.data.some(turn => turn.id === turnId)) return true

    cursor = page.nextCursor
  } while (cursor !== null)

  return false
}

/** Null when Codex no longer has `beforeTurnId`, so nothing is left to drop. */
export async function requestRevert(
  server: AppServer,
  threadId: string,
  beforeTurnId: string
) {
  try {
    return await server.request('thread/revert', {threadId, beforeTurnId})
  } catch (error) {
    if (server.hasExited) throw error

    if (await holdsTurn(server, threadId, beforeTurnId)) throw error

    return null
  }
}
