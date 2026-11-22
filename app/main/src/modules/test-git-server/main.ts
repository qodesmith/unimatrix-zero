import type {AddressInfo} from 'node:net'

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {onTestFinished} from 'vitest'

/**
 * Serves `root` over git's dumb HTTP protocol, and asks for a login for every
 * path under `/private/`, as a host does for a private repo.
 */
export async function servedOverHttp(root: string) {
  const server = http.createServer((request, response) => {
    const {pathname} = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (pathname.startsWith('/private/')) {
      response
        .writeHead(401, {'WWW-Authenticate': 'Basic realm="private"'})
        .end()

      return
    }

    fs.readFile(path.join(root, pathname), (error, data) => {
      response.writeHead(error ? 404 : 200).end(data)
    })
  })

  onTestFinished(() => {
    server.close()
  })

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- it listens on a TCP port, so address() is an AddressInfo
  const {port} = server.address() as AddressInfo

  return `http://127.0.0.1:${port}`
}
