import {createServer} from 'node:net'

/** Only `EADDRINUSE` is taken; Codex reports other errors when it binds. */
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
