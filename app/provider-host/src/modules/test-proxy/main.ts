import {once} from 'node:events'
import http from 'node:http'
import net from 'node:net'
import {z} from 'zod'

/** Starts `server` on a free local port, and gives its URL. */
export async function listenLocally(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const {port} = z.looseObject({port: z.number()}).parse(server.address())

  return `http://127.0.0.1:${port}`
}

/**
 * A CONNECT proxy for a vendor program's `HTTPS_PROXY`. It stands for a
 * network with no route to the Provider without touching the machine's own.
 */
export async function startProxy() {
  const open = new Set<net.Socket>()
  let refusing = false
  let lifting: NodeJS.Timeout | undefined

  const server = http.createServer((_request, response) => response.end())

  server.on('connect', (request, client: net.Socket) => {
    if (refusing) {
      client.resetAndDestroy()

      return
    }

    const [host = '', port = '443'] = (request.url ?? '').split(':')

    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client)
      client.pipe(upstream)
    })

    for (const socket of [client, upstream]) {
      open.add(socket)
      socket.on('close', () => open.delete(socket))
    }

    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })

  const url = await listenLocally(server)

  function cutConnections() {
    for (const socket of open) socket.resetAndDestroy()
  }

  return {
    url,
    /** Resets every open connection and every new one until `ms` has passed. */
    refuseFor(ms: number) {
      refusing = true
      cutConnections()
      clearTimeout(lifting)
      lifting = setTimeout(() => {
        refusing = false
      }, ms)
    },
    close() {
      clearTimeout(lifting)
      cutConnections()
      server.close()
    },
  }
}
