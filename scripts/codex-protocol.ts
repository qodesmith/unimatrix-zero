/** The standalone `codex-app-server` can't generate types; the full `codex` can. */
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import {CODEX_PROTOCOL, MANIFEST} from './vendor-pins.ts'

const root = path.resolve(import.meta.dirname, '..')

const manifest = z
  .looseObject({
    vendorPrograms: z.looseObject({
      codex: z.looseObject({version: z.string()}),
    }),
  })
  .parse(JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8')))

const out = path.join(root, CODEX_PROTOCOL)

const codex = process.argv[2] ?? 'codex'
const pinned = manifest.vendorPrograms.codex.version
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-codex-protocol-'))
const env = {...process.env, CODEX_HOME: home}

function generate() {
  const version = spawnSync(codex, ['--version'], {encoding: 'utf8', env})
  const found = version.stdout.trim().split(' ').at(-1)

  if (found !== pinned) {
    console.error(`The manifest pins Codex ${pinned}; ${codex} is ${found}.`)

    return 1
  }

  fs.rmSync(out, {recursive: true, force: true})

  return (
    spawnSync(codex, ['app-server', 'generate-ts', '--out', out], {
      stdio: 'inherit',
      env,
    }).status ?? 1
  )
}

const status = generate()

fs.rmSync(home, {recursive: true, force: true})

process.exit(status)
