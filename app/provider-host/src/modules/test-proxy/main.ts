import {once} from 'node:events'
import http from 'node:http'
import net from 'node:net'
import {z} from 'zod'

export async function listenLocally(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const {port} = z.looseObject({port: z.number()}).parse(server.address())

  return `http://127.0.0.1:${port}`
}

/**
 * More than a TLS handshake, a WebSocket upgrade and a small request send;
 * less than a Model request.
 */
const PROMPT_BYTES = 8000

/** A CONNECT proxy for `HTTPS_PROXY` that cuts off the Provider alone. */
export async function startProxy() {
  const open = new Set<net.Socket>()
  let refusing = false
  let resettingStreams = false
  let lifting: NodeJS.Timeout | undefined

  const server = http.createServer((_request, response) => response.end())

  server.on('connect', (request, client: net.Socket) => {
    if (refusing) {
      client.resetAndDestroy()

      return
    }

    const [host = '', port = '443'] = (request.url ?? '').split(':')
    let sent = 0

    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client)
      client.pipe(upstream)
    })

    client.on('data', (chunk: Buffer) => {
      sent += chunk.length
    })

    upstream.on('data', () => {
      if (resettingStreams && sent > PROMPT_BYTES) {
        // Lets the chunk through first, so the answer has started to flow.
        setImmediate(() => {
          client.resetAndDestroy()
          upstream.resetAndDestroy()
        })
      }
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
    refuseFor(ms: number) {
      refusing = true
      cutConnections()
      clearTimeout(lifting)
      lifting = setTimeout(() => {
        refusing = false
      }, ms)
    },
    /**
     * Resets each new connection once a Model answer starts. Codex can miss a
     * reset on a reused WebSocket for 300 s, so open ones are reset too.
     */
    resetStreams() {
      resettingStreams = true
      cutConnections()
    },
    letThrough() {
      clearTimeout(lifting)
      refusing = false
    },
    close() {
      clearTimeout(lifting)
      cutConnections()
      server.close()
    },
  }
}
