import {
  identity,
  repoToServe,
  servedOverHttp,
  servedOverHttps,
} from '#modules/test-git-server/main'
import {DEV_MANIFEST, gitFolderFor} from '#modules/vendor-programs/main'
import {NO_GIT_LOGIN, withNoGitLogin} from '@uz/vendor-program/git-login'
import {execFile} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {promisify} from 'node:util'
import {describe, expect, inject, it} from 'vitest'

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

  // A plain path copies files, skipping git-upload-pack and git-receive-pack.
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

/** CI sets it on a machine whose only `git` is the app's, last on `PATH`. */
const noGit = process.env.UZ_NO_GIT === '1'

/** Runs `git` by name, as a command the AI runs finds it. */
function gitIn(folder: string): Git {
  return async (args, cwd = os.tmpdir()) =>
    ended('/bin/sh', ['-c', 'git "$@"', 'sh', ...args], {
      cwd,
      env: withLast(folder),
    })
}

function wrapped() {
  const folder = temporaryFolder()
  writeGitWrapper(folder, inject('gitProgram'))

  return gitIn(folder)
}

/**
 * The stand-in runs its first argument as a shell command. `ldd` comes
 * first on `PATH`, saying how it finds `libcurl.so.4`.
 */
function standIn(libcurl: 'found' | 'not found') {
  const build = path.join(temporaryFolder(), 'git')
  const folder = temporaryFolder()
  const program = path.join(build, 'bin', 'git')
  const subPrograms = path.join(build, 'libexec', 'git-core')
  fs.mkdirSync(path.dirname(program), {recursive: true})
  fs.mkdirSync(subPrograms, {recursive: true})
  fs.writeFileSync(path.join(subPrograms, 'git-remote-http'), '')
  fs.writeFileSync(program, '#!/bin/sh\neval "$1"\n', {mode: 0o755})
  writeGitWrapper(folder, program)

  const tools = temporaryFolder()

  const found =
    libcurl === 'found' ? '/usr/lib/libcurl.so.4 (0x1)' : 'not found'

  fs.writeFileSync(
    path.join(tools, 'ldd'),
    `#!/bin/sh\n[ "$1" = '${subPrograms}/git-remote-http' ] && echo "\tlibcurl.so.4 => ${found}"\n`,
    {mode: 0o755}
  )

  return async (args: string[], env: NodeJS.ProcessEnv = {}) =>
    ended(path.join(folder, 'git'), args, {
      cwd: os.tmpdir(),
      env: {...env, PATH: `${tools}${path.delimiter}/usr/bin:/bin`},
    })
}

describe.runIf(process.platform !== 'win32')(
  'the Linux script, with a stand-in for the build',
  () => {
    it('adds one plain line to a failed git when the system lacks libcurl.so.4', async () => {
      const git = standIn('not found')

      const failed = await git(['echo failed >&2; exit 128'])

      expect(failed).toEqual({
        code: 128,
        stdout: '',
        stderr: `failed\ngit: can't use https:// addresses on this computer, which lacks the libcurl.so.4 library.\n`,
      })

      const succeeded = await git(['echo worked'])

      expect(succeeded).toEqual({code: 0, stdout: 'worked\n', stderr: ''})
    })

    it('adds nothing to a failed git when libcurl.so.4 is found', async () => {
      const git = standIn('found')

      const failed = await git(['echo failed >&2; exit 3'])

      expect(failed).toEqual({code: 3, stdout: '', stderr: 'failed\n'})
    })

    it('keeps ssh from opening a password program, even one the user forces', async () => {
      const git = standIn('found')

      const seen = await git(['echo "$SSH_ASKPASS_REQUIRE"'], {
        SSH_ASKPASS_REQUIRE: 'force',
      })

      expect(seen.stdout).toBe('never\n')
    })
  }
)

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

      expect(system.stdout).toContain(
        'credential.https://dev.azure.com.usehttppath=true'
      )
    })

    it('reads, clones and fetches a remote that needs no login over HTTPS, with the system’s libcurl and certificates', async () => {
      const git = wrapped()
      const work = temporaryFolder()
      const {first, origin} = await repoToServe(git, work)
      const commit = await git(['rev-parse', 'HEAD'], first)
      const url = `${await servedOverHttps(work)}/${path.basename(origin)}`

      const remote = await git(['ls-remote', url, 'refs/heads/main'])

      expect(remote.stdout).toBe(`${commit.stdout.trim()}\trefs/heads/main\n`)

      const clone = await git(['clone', url, 'second'], work)
      const fetch = await git(['fetch', 'origin'], path.join(work, 'second'))

      expect([clone.code, fetch.code]).toEqual([0, 0])
    })

    it('fails a git that needs a login at once and says what to do', async () => {
      const git = wrapped()
      const host = await servedOverHttp(temporaryFolder())

      const denied = await git(['ls-remote', `${host}/private/repo.git`])

      expect(denied.code).toBe(128)
      expect(denied.stderr).toBe(
        `${NO_GIT_LOGIN}\nfatal: could not read Username for '${host}': terminal prompts disabled\n`
      )
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
        {cwd, env: withNoGitLogin(withLast(folder))}
      )
    }

    it('fails a git that needs a login at once and says what to do', async () => {
      const host = await servedOverHttp(temporaryFolder())

      const denied = await git(['ls-remote', `${host}/private/repo.git`])

      expect(denied.code).toBe(128)
      expect(denied.stderr).toContain(`${NO_GIT_LOGIN}\n`)
      expect(denied.stderr).toContain(
        `fatal: could not read Username for '${host}': terminal prompts disabled`
      )
    })

    it('clones a remote that needs no login over HTTP', async () => {
      const work = temporaryFolder()
      const {origin} = await repoToServe(git, work)
      const url = `${await servedOverHttp(work)}/${path.basename(origin)}`

      const clone = await git(['clone', url, 'second'], work)

      expect(clone.code).toBe(0)
    })

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
