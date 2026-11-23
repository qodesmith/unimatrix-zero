import {
  identity,
  repoToServe,
  servedOverHttp,
} from '#modules/test-git-server/main'
import {DEV_MANIFEST} from '#modules/vendor-programs/main'
import {NO_GIT_LOGIN} from '@uz/vendor-program/git-login'
import {execFile} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import {describe, expect, inject, it} from 'vitest'

import {writeDeveloperFolder} from './main'

const run = promisify(execFile)

interface Ended {
  code: number | string | undefined
  stdout: string
  stderr: string
}

/** A space in the path, as `Application Support` has. */
function temporaryFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uz developer folder '))
}

/** Without `DEVELOPER_DIR`, a Mac with no developer tools opens a dialog. */
async function stub(
  developerDir: string,
  tool: string,
  args: string[],
  cwd = os.tmpdir(),
  env: NodeJS.ProcessEnv = {}
): Promise<Ended> {
  const home = path.join(developerDir, 'home')
  fs.mkdirSync(home, {recursive: true})

  try {
    const {stdout, stderr} = await run(path.join('/usr/bin', tool), args, {
      cwd,
      env: {
        ...env,
        PATH: '/usr/bin:/bin',
        HOME: home,
        DEVELOPER_DIR: developerDir,
      },
    })

    return {code: 0, stdout, stderr}
  } catch (error) {
    const {code, stdout, stderr} = error as Partial<Ended>

    return {code, stdout: stdout ?? '', stderr: stderr ?? ''}
  }
}

describe.runIf(process.platform === 'darwin')('on a Mac', () => {
  it('runs the app’s own git for the git stub, from a folder with a space in its path', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))

    const version = await stub(folder, 'git', ['--version'])

    expect(version).toEqual({
      code: 0,
      stdout: `git version ${DEV_MANIFEST.vendorPrograms.git.version}\n`,
      stderr: '',
    })

    const execPath = await stub(folder, 'git', ['--exec-path'])

    expect(execPath.stdout.trim()).toBe(
      path.join(path.dirname(inject('gitProgram')), '..', 'libexec', 'git-core')
    )
  })

  it('finds git’s templates on init, its sub-programs on clone, fetch and push, and its own system config', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))
    const work = temporaryFolder()
    const origin = path.join(work, 'origin.git')
    const first = path.join(work, 'first')
    const second = path.join(work, 'second')
    fs.mkdirSync(first)

    const init = await stub(folder, 'git', ['init', '-b', 'main'], first)

    expect(init.stderr).toBe('')
    // The templates' own file: a `git` with no templates writes no `info`.
    expect(fs.existsSync(path.join(first, '.git', 'info', 'exclude'))).toBe(
      true
    )

    fs.writeFileSync(path.join(first, 'note.txt'), 'one\n')
    await stub(folder, 'git', ['add', 'note.txt'], first)
    await stub(folder, 'git', [...identity, 'commit', '-m', 'one'], first)
    await stub(folder, 'git', ['init', '--bare', '-b', 'main', origin], work)

    // A plain path copies files, skipping git-upload-pack and git-receive-pack.
    const url = `file://${origin}`
    const push = await stub(folder, 'git', ['push', url, 'main'], first)

    expect(push.code).toBe(0)

    const clone = await stub(folder, 'git', ['clone', url, second], work)

    expect(clone.code).toBe(0)
    expect(fs.readFileSync(path.join(second, 'note.txt'), 'utf8')).toBe('one\n')

    fs.writeFileSync(path.join(first, 'note.txt'), 'two\n')
    await stub(folder, 'git', [...identity, 'commit', '-am', 'two'], first)
    await stub(folder, 'git', ['push', url, 'main'], first)
    const fetch = await stub(folder, 'git', ['fetch', 'origin'], second)

    const fetched = await stub(
      folder,
      'git',
      ['show', 'origin/main:note.txt'],
      second
    )

    expect(fetch.code).toBe(0)
    expect(fetched.stdout).toBe('two\n')

    const system = await stub(folder, 'git', ['config', '--system', '--list'])

    expect(system.stdout).toContain(
      'credential.https://dev.azure.com.usehttppath=true'
    )
  })

  it('runs the same build’s programs for the other git stubs', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))
    const work = temporaryFolder()
    await stub(folder, 'git', ['init', '--bare', '-b', 'main', work])

    const advertised = await stub(folder, 'git-upload-pack', [
      '--advertise-refs',
      work,
    ])

    expect(advertised.code).toBe(0)
    expect(advertised.stdout).toContain(
      `agent=git/${DEV_MANIFEST.vendorPrograms.git.version}`
    )

    for (const tool of ['git-receive-pack', 'git-upload-archive']) {
      const ended = await stub(folder, tool, [path.join(work, 'missing')])

      // Git's own refusal, where the script's would be 127.
      expect(ended.code).toBe(128)
      expect(ended.stderr).toMatch(/^fatal: /)
    }

    const shell = await stub(folder, 'git-shell', ['-c', 'git-upload-pack'])

    expect(shell.code).toBe(128)
    expect(shell.stderr).toMatch(/^fatal: /)
  })

  it('fails a git that needs a login at once and says what to do, after the user’s own helper, running no askpass program of the user’s', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))
    const home = path.join(folder, 'home')
    fs.mkdirSync(home, {recursive: true})
    fs.writeFileSync(
      path.join(home, '.gitconfig'),
      '[credential]\n\thelper = "!echo the user’s helper >&2"\n'
    )
    const askpass = path.join(folder, 'askpass')
    fs.writeFileSync(askpass, '#!/bin/sh\necho "askpass $1" >&2\n', {
      mode: 0o755,
    })
    const host = await servedOverHttp(temporaryFolder())

    const denied = await stub(
      folder,
      'git',
      ['ls-remote', `${host}/private/repo.git`],
      os.tmpdir(),
      {SSH_ASKPASS: askpass}
    )

    expect(denied.code).toBe(128)
    expect(denied.stderr).toBe(
      `the user’s helper get\n${NO_GIT_LOGIN}\nfatal: could not read Username for '${host}': terminal prompts disabled\n`
    )
  })

  it('keeps the git settings already in the environment', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))

    const name = await stub(
      folder,
      'git',
      ['config', 'user.name'],
      os.tmpdir(),
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'user.name',
        GIT_CONFIG_VALUE_0: 'Sam',
      }
    )

    expect(name.stdout).toBe('Sam\n')
  })

  it('clones and fetches a repo that needs no login over HTTP', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))
    const work = temporaryFolder()
    const second = path.join(work, 'second')

    const {first, origin} = await repoToServe(
      async (args, cwd) => stub(folder, 'git', args, cwd),
      work
    )

    const url = `${await servedOverHttp(work)}/${path.basename(origin)}`

    const clone = await stub(folder, 'git', ['clone', url, second], work)

    expect(clone.code).toBe(0)

    fs.writeFileSync(path.join(first, 'note.txt'), 'two\n')
    await stub(folder, 'git', [...identity, 'commit', '-am', 'two'], first)
    await stub(folder, 'git', ['push', origin, 'main'], first)
    await stub(folder, 'git', ['update-server-info'], origin)
    const fetch = await stub(folder, 'git', ['fetch', 'origin'], second)

    const fetched = await stub(
      folder,
      'git',
      ['show', 'origin/main:note.txt'],
      second
    )

    expect(fetch.code).toBe(0)
    expect(fetched.stdout).toBe('two\n')
  })

  it('fails every other stub with a one-line error and 127', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, inject('gitProgram'))

    for (const tool of ['python3', 'make', 'clang']) {
      expect(await stub(folder, tool, ['--version'])).toEqual({
        code: 127,
        stdout: '',
        stderr: `${tool}: not installed on this Mac\n`,
      })
    }
  })

  it('fails git with a not-ready error until the build is in place, then runs it from the same script', async () => {
    const folder = temporaryFolder()
    const build = path.join(temporaryFolder(), 'git')
    writeDeveloperFolder(folder, path.join(build, 'bin', 'git'))

    const waiting = await stub(folder, 'git', ['--version'])

    expect(waiting.code).toBe(127)
    expect(waiting.stdout).toBe('')
    expect(waiting.stderr).toMatch(/^git: not ready yet: .+\n$/)

    fs.symlinkSync(path.join(path.dirname(inject('gitProgram')), '..'), build)

    const ready = await stub(folder, 'git', ['--version'])

    expect(ready.stdout).toMatch(/^git version /)
  })

  it('says git is not installed when the manifest has none for this Mac', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, null)

    expect(await stub(folder, 'git', ['--version'])).toEqual({
      code: 127,
      stdout: '',
      stderr: 'git: not installed on this Mac\n',
    })
  })

  it('writes the script again over one a launch before left', async () => {
    const folder = temporaryFolder()
    writeDeveloperFolder(folder, null)
    writeDeveloperFolder(folder, inject('gitProgram'))

    expect((await stub(folder, 'git', ['--version'])).code).toBe(0)
  })
})
