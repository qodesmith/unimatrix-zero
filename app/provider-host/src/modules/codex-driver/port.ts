import {createServer} from 'node:net'

/**
 * Whether nothing listens on `port` on 127.0.0.1. Only `EADDRINUSE` counts
 * as taken; any other error is left for Codex to report when it binds.
 */
export async function portFree(port: number) {
  const server = createServer()
  const {promise, resolve} = Promise.withResolvers<boolean>()

  server.once('listening', () => server.close(() => resolve(true)))
  server.once('error', (error: NodeJS.ErrnoException) =>
    resolve(error.code !== 'EADDRINUSE')
  )
  server.listen({host: '127.0.0.1', port})

  return promise
}
