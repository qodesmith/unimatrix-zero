import {DEV_MANIFEST} from '#modules/vendor-programs/main'
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

/**
 * Runs one of Apple's stubs in `/usr/bin` the way a command the AI runs finds
 * it: by name, with only `DEVELOPER_DIR` naming the app's folder. Never
 * without `DEVELOPER_DIR`, which on a Mac with no developer tools opens the
 * install dialog.
 */
async function stub(
  developerDir: string,
  tool: string,
  args: string[],
  cwd = os.tmpdir()
): Promise<Ended> {
  const home = path.join(developerDir, 'home')
  fs.mkdirSync(home, {recursive: true})

  try {
    const {stdout, stderr} = await run(path.join('/usr/bin', tool), args, {
      cwd,
      env: {PATH: '/usr/bin:/bin', HOME: home, DEVELOPER_DIR: developerDir},
    })

    return {code: 0, stdout, stderr}
  } catch (error) {
    const {code, stdout, stderr} = error as Partial<Ended>

    return {code, stdout: stdout ?? '', stderr: stderr ?? ''}
  }
}

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']

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

    // A `file://` URL goes through git-upload-pack and git-receive-pack, where
    // a plain path would copy the files.
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

    // A line of the build's own `etc/gitconfig`.
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
    expect(advertised.stdout).toContain('agent=git/')

    for (const tool of ['git-receive-pack', 'git-upload-archive']) {
      const ended = await stub(folder, tool, [path.join(work, 'missing')])

      // Git's own refusal, where the script's would be 127.
      expect(ended.code).toBe(128)
      expect(ended.stderr).toMatch(/^fatal: /)
    }

    const shell = await stub(folder, 'git-shell', ['-c', 'git-upload-pack'])

    expect(shell.stderr).not.toContain('not installed')
    expect(shell.code).not.toBe(127)
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

    // The download unpacks elsewhere and is renamed into place.
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
