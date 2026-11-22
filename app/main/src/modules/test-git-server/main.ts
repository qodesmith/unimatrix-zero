import type {AddressInfo, Server} from 'node:net'

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import {onTestFinished} from 'vitest'

type Git = (args: string[], cwd: string) => Promise<object>

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

/**
 * Serves `root` over git's dumb HTTP protocol, and asks for a login for every
 * path under `/private/`, as a host does for a private repo.
 */
function answering(root: string): http.RequestListener {
  return (request, response) => {
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
  }
}

async function listening(server: Server, scheme: string) {
  onTestFinished(() => {
    server.close()
  })

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- it listens on a TCP port, so address() is an AddressInfo
  const {port} = server.address() as AddressInfo

  return `${scheme}://127.0.0.1:${port}`
}

export async function servedOverHttp(root: string) {
  return listening(http.createServer(answering(root)), 'http')
}

/** CI makes and trusts the certificate. */
export async function servedOverHttps(root: string) {
  const tls = process.env.UZ_TLS_FOLDER

  if (!tls) {
    throw new Error('UZ_TLS_FOLDER names no certificate for 127.0.0.1.')
  }

  const server = https.createServer(
    {
      cert: fs.readFileSync(path.join(tls, 'cert.pem')),
      key: fs.readFileSync(path.join(tls, 'key.pem')),
    },
    answering(root)
  )

  return listening(server, 'https')
}

/** Makes `first`, a repo, and `origin.git`, its bare copy to serve, in `work`. */
export async function repoToServe(git: Git, work: string) {
  const first = path.join(work, 'first')
  fs.mkdirSync(first)
  await git(['init', '-b', 'main'], first)
  fs.writeFileSync(path.join(first, 'note.txt'), 'one\n')
  await git(['add', 'note.txt'], first)
  await git([...identity, 'commit', '-m', 'one'], first)
  await git(['clone', '--bare', first, 'origin.git'], work)
  await git(['update-server-info'], path.join(work, 'origin.git'))
}
