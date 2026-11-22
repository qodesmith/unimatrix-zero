import type {AddressInfo} from 'node:net'

import {DEV_MANIFEST, gitFolderFor} from '#modules/vendor-programs/main'
import {execFile} from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {promisify} from 'node:util'
import {describe, expect, inject, it, onTestFinished} from 'vitest'

import {writeGitWrapper} from './main'

const run = promisify(execFile)

interface Ended {
  code: number | string | undefined
  stdout: string
  stderr: string
}

/** A space in the path, as a user's data folder can have. */
function temporaryFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uz git folder '))
}

/** `PATH` under whichever name the environment holds it: Windows has `Path`. */
function withLast(folder: string) {
  const name =
    Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'

  return {
    ...process.env,
    [name]: `${process.env[name] ?? ''}${path.delimiter}${folder}`,
  }
}

async function ended(
  command: string,
  args: string[],
  options: {cwd: string; env: NodeJS.ProcessEnv}
): Promise<Ended> {
  try {
    const {stdout, stderr} = await run(command, args, options)

    return {code: 0, stdout, stderr}
  } catch (error) {
    const {code, stdout, stderr} = error as Partial<Ended>

    return {code, stdout: stdout ?? '', stderr: stderr ?? ''}
  }
}

type Git = (args: string[], cwd?: string) => Promise<Ended>

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

/**
 * A `file://` URL runs git-upload-pack and git-receive-pack; a plain path would
 * copy the files.
 */
async function initPushCloneFetch(git: Git) {
  const work = temporaryFolder()
  const origin = path.join(work, 'origin.git')
  const first = path.join(work, 'first')
  const second = path.join(work, 'second')
  fs.mkdirSync(first)

  const init = await git(['init', '-b', 'main'], first)

  // The templates' own file: a `git` with no templates writes no `info`.
  const excludes = fs.existsSync(path.join(first, '.git', 'info', 'exclude'))

  fs.writeFileSync(path.join(first, 'note.txt'), 'one\n')
  await git(['add', 'note.txt'], first)
  await git([...identity, 'commit', '-m', 'one'], first)
  await git(['init', '--bare', '-b', 'main', origin], work)

  const url = pathToFileURL(origin).href
  const push = await git(['push', url, 'main'], first)
  const clone = await git(['clone', url, second], work)

  fs.writeFileSync(path.join(first, 'note.txt'), 'two\n')
  await git([...identity, 'commit', '-am', 'two'], first)
  await git(['push', url, 'main'], first)
  const fetch = await git(['fetch', 'origin'], second)
  const fetched = await git(['show', 'origin/main:note.txt'], second)

  return {
    init: init.code,
    excludes,
    push: push.code,
    clone: clone.code,
    fetch: fetch.code,
    // PowerShell may end the line its own way.
    fetched: fetched.stdout.trim(),
  }
}

const worked = {
  init: 0,
  excludes: true,
  push: 0,
  clone: 0,
  fetch: 0,
  fetched: 'two',
}

/** A build adds its own ending: `.windows.1`, or `.dirty` on Linux arm64. */
const PINNED_VERSION = new RegExp(
  `^git version ${DEV_MANIFEST.vendorPrograms.git.version.replaceAll('.', String.raw`\.`)}\\b`
)

/**
 * CI sets `UZ_NO_GIT` on a machine with no `git`, so only the app's folder,
 * last on `PATH`, has one.
 */
const noGit = process.env.UZ_NO_GIT === '1'

/** Runs `git` by name, as a command the AI runs finds it. */
function gitIn(folder: string): Git {
  return async (args, cwd = os.tmpdir()) =>
    ended('/bin/sh', ['-c', 'git "$@"', 'sh', ...args], {
      cwd,
      env: withLast(folder),
    })
}

/**
 * Serves a folder over HTTPS for git's dumb HTTP protocol. Linux CI makes the
 * certificate and adds it to the system's trusted ones.
 */
async function served(root: string) {
  const tls = process.env.UZ_TLS_FOLDER

  if (!tls) {
    throw new Error('UZ_TLS_FOLDER names no certificate for 127.0.0.1.')
  }

  const server = https.createServer(
    {
      cert: fs.readFileSync(path.join(tls, 'cert.pem')),
      key: fs.readFileSync(path.join(tls, 'key.pem')),
    },
    (request, response) => {
      const {pathname} = new URL(request.url ?? '/', 'https://127.0.0.1')

      fs.readFile(path.join(root, pathname), (error, data) => {
        response.writeHead(error ? 404 : 200).end(data)
      })
    }
  )

  onTestFinished(() => {
    server.close()
  })

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })

  return (server.address() as AddressInfo).port
}

function wrapped() {
  const folder = temporaryFolder()
  writeGitWrapper(folder, inject('gitProgram'))

  return gitIn(folder)
}

describe.runIf(noGit && process.platform === 'linux')(
  'on Linux with no git',
  () => {
    it('runs the app’s own git for a git found last on PATH', async () => {
      const git = wrapped()

      const version = await git(['--version'])

      expect(version.stderr).toBe('')
      expect(version.stdout).toMatch(PINNED_VERSION)
    })

    it('finds git’s templates on init, its sub-programs on clone, fetch and push, and its own system config', async () => {
      const git = wrapped()

      expect(await initPushCloneFetch(git)).toEqual(worked)

      const system = await git(['config', '--system', '--list'])

      // A line of the build's own `etc/gitconfig`.
      expect(system.stdout).toContain(
        'credential.https://dev.azure.com.usehttppath=true'
      )
    })

    it('reads a remote over HTTPS with the system’s libcurl and certificates', async () => {
      const git = wrapped()
      const work = temporaryFolder()
      const first = path.join(work, 'first')
      fs.mkdirSync(first)
      await git(['init', '-b', 'main'], first)
      fs.writeFileSync(path.join(first, 'note.txt'), 'one\n')
      await git(['add', 'note.txt'], first)
      await git([...identity, 'commit', '-m', 'one'], first)
      await git(['clone', '--bare', first, 'origin.git'], work)
      await git(['update-server-info'], path.join(work, 'origin.git'))
      const commit = await git(['rev-parse', 'HEAD'], first)
      const port = await served(work)

      const remote = await git([
        'ls-remote',
        `https://127.0.0.1:${port}/origin.git`,
        'refs/heads/main',
      ])

      expect(remote.stdout).toBe(`${commit.stdout.trim()}\trefs/heads/main\n`)
    })

    it('fails git with a not-ready error until the build is in place, then runs it from the same script', async () => {
      const folder = temporaryFolder()
      const build = path.join(temporaryFolder(), 'git')
      writeGitWrapper(folder, path.join(build, 'bin', 'git'))
      const git = gitIn(folder)

      const waiting = await git(['--version'])

      expect(waiting.code).toBe(127)
      expect(waiting.stdout).toBe('')
      expect(waiting.stderr).toMatch(/^git: not ready yet: .+\n$/)

      fs.symlinkSync(path.join(path.dirname(inject('gitProgram')), '..'), build)

      const ready = await git(['--version'])

      expect(ready.stdout).toMatch(/^git version /)
    })
  }
)

describe.runIf(noGit && process.platform === 'win32')(
  'on Windows with no git',
  () => {
    const folder = gitFolderFor(inject('machine')) ?? ''

    /** Runs `git` by name through PowerShell, as both Providers do there. */
    async function git(args: string[], cwd = os.tmpdir()) {
      const words = args.map(arg => `'${arg.replaceAll("'", "''")}'`)

      return ended(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `git ${words.join(' ')}; exit $LASTEXITCODE`,
        ],
        {cwd, env: withLast(folder)}
      )
    }

    it('runs the app’s own git for a git found last on PATH', async () => {
      const found = await ended('where.exe', ['git'], {
        cwd: os.tmpdir(),
        env: withLast(folder),
      })

      // One line: no other `git` is found. Windows paths differ in case alone.
      expect(found.stdout.trim().toLowerCase()).toBe(
        inject('gitProgram').toLowerCase()
      )

      const version = await git(['--version'])

      expect(version.stdout).toMatch(PINNED_VERSION)
    })

    it('finds git’s templates on init and its sub-programs on clone, fetch and push', async () => {
      expect(await initPushCloneFetch(git)).toEqual(worked)
    })
  }
)
