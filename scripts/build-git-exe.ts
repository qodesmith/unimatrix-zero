/** Builds the Windows `git.exe` that runs the app's own `git` (ADR 0026). */
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'shell/git-exe')

// Not `shell/dist`, which the shell's own build empties.
const out = path.join(source, 'dist')

const GOARCH = {'win32-x64': 'amd64', 'win32-arm64': 'arm64'}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const pinned = /^go (\S+)$/m.exec(
  fs.readFileSync(path.join(source, 'go.mod'), 'utf8')
)?.[1]

if (pinned === undefined) {
  fail('shell/git-exe/go.mod names no Go version.')
}

const install = `Install Go ${pinned} from https://go.dev/dl/ and put its bin folder on PATH.`

const go = Bun.which('go') ?? fail(`go isn't on PATH. ${install}`)

// `local`, so go never fetches another version in place of the one checked.
const env = {
  ...process.env,
  GOTOOLCHAIN: 'local',
  CGO_ENABLED: '0',
  GOOS: 'windows',
}

const version = spawnSync(go, ['env', 'GOVERSION'], {
  cwd: source,
  encoding: 'utf8',
  env,
}).stdout.trim()

if (version !== `go${pinned}`) {
  fail(
    `go is ${version || 'some other version'}, but shell/git-exe/go.mod names ${pinned}. ${install}`
  )
}

for (const [target, arch] of Object.entries(GOARCH)) {
  const file = path.join(out, target, 'git.exe')

  const {status} = spawnSync(
    go,
    [
      'build',
      '-trimpath',
      // Otherwise go stamps the commit, and a changed file, into the program.
      '-buildvcs=false',
      '-ldflags=-s -w -buildid=',
      '-o',
      file,
      '.',
    ],
    {cwd: source, stdio: 'inherit', env: {...env, GOARCH: arch}}
  )

  if (status !== 0) {
    process.exit(status ?? 1)
  }

  console.log(`${path.relative(root, file)}: ${fs.statSync(file).size} bytes`)
}
