import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g

const HOME = /(?:\/(?:Users|home)\/|-(?:Users|home)-)[^/"\\\s-]+/g

// The backslashes match a key inside JSON that a recorded string holds.
const ID =
  /(?:account_?id|user_?id|installation_?id|(?:organization|account)_?uuid)\\*":\\*"([^"\\]*)/gi

const MAC_TEMP = /\/var\/folders\/|-var-folders-/g

const VERSION = /\d+\.\d+\.\d+[\w.+-]*/

const TEMP_FOLDER_STAND_IN = '/temp-folder'

export const HOME_STAND_IN = '/Users/sam'

const claims = new Map<string, symbol>()

/**
 * Claims each of `files` for a new recorder, and gives its `write`, which
 * writes a file only while no later recorder has claimed it. A retried live
 * test's first try shares this process, so it can't write over the retry's.
 */
export function claimRecordings(files: string[]) {
  const claim = Symbol('recorder')

  for (const file of files) claims.set(path.resolve(file), claim)

  // Synchronous, so no claim is taken between the check and the write.
  return function write(file: string, text: string) {
    if (claims.get(path.resolve(file)) !== claim) return

    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, text)
  }
}

function asProjectKey(folder: string) {
  return folder.replaceAll(/[^a-zA-Z0-9]/g, '-')
}

/** The real path first, since the other can sit inside it. */
function tempFolders() {
  return [fs.realpathSync(os.tmpdir()), os.tmpdir()]
}

/** Each way a recording can name this machine's temp folder, with its stand-in. */
export function tempFolderNames() {
  const folders = tempFolders().map(folder =>
    JSON.stringify(folder).slice(1, -1)
  )

  return {
    paths: folders.map(folder => [folder, TEMP_FOLDER_STAND_IN] as const),
    projectKeys: folders.map(
      folder =>
        [asProjectKey(folder), asProjectKey(TEMP_FOLDER_STAND_IN)] as const
    ),
  }
}

/**
 * This machine's temp and home folders, each with its stand-in, in the order
 * a recorder swaps them.
 */
export function machineStandIns() {
  return [
    ...tempFolders().map(folder => [folder, TEMP_FOLDER_STAND_IN] as const),
    ...[fs.realpathSync(os.homedir()), os.homedir()].map(
      folder => [folder, HOME_STAND_IN] as const
    ),
  ]
}

/** A setting a replay test changes on purpose, which its fake won't compare. */
export interface SkippedSetting<Field extends string = string> {
  field: Field
  reason: string
  /** Only the vendor program started at this place, from 0; else every one. */
  run?: number
}

/**
 * For a fake's script: `changedSetting` says which of `fields` the app sent
 * differently from the recording, once `withStandIns` has named the test's
 * folders as the recording does.
 */
export const SETTINGS_CHECK = `
function quoted(text) {
  return JSON.stringify(text).slice(1, -1)
}

function withStandIns(value, pairs) {
  let text = JSON.stringify(value ?? null)
  for (const [real, recorded] of pairs) {
    if (real && recorded) text = text.replaceAll(quoted(real), quoted(recorded))
  }
  return JSON.parse(text)
}

function keysSorted(value) {
  if (Array.isArray(value)) return value.map(keysSorted)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, keysSorted(value[key])]))
}

// Windows joins a path with backslashes, and every recording was made on a Mac.
function recordedSeparators(json) {
  return process.platform === 'win32' ? json.replaceAll('\\\\\\\\', '/') : json
}

function changedSetting(where, fields, recorded, sent, skip) {
  for (const field of fields) {
    if (skip.some(skipped => skipped.field === field)) continue
    const [was, is] = [recorded[field], sent[field]].map(value => recordedSeparators(JSON.stringify(keysSorted(value ?? null))))
    if (was !== is) {
      return 'The app sent a different ' + where + ' ' + field + ' than the recording holds, so the recording no longer shows what the Provider answers. Re-record it with bun run provider-checks (docs/code-style/testing.md).\\nRecorded: ' + was + '\\nSent: ' + is
    }
  }
  return null
}
`

/**
 * Replaces `from` in the pieces as if they were one string, keeping each
 * piece's place: a match goes into the piece it starts in.
 */
export function replaceAcross(pieces: string[], from: string, to: string) {
  const whole = pieces.join('')
  let length = 0
  const ends = pieces.map(piece => (length += piece.length))
  const out = pieces.map(() => '')
  let piece = 0

  for (let at = 0; at < whole.length;) {
    while ((ends[piece] ?? Infinity) <= at) piece++

    const matched = from !== '' && whole.startsWith(from, at)
    out[piece] = `${out[piece] ?? ''}${matched ? to : (whole[at] ?? '')}`
    at += matched ? from.length : 1
  }

  return out
}

/** What a recording's `start` line names it by, such as `codex 0.163.0`. */
export function buildOf(name: string, program: string) {
  const {stdout} = spawnSync(program, ['--version'], {encoding: 'utf8'})
  const version = VERSION.exec(stdout)?.[0]

  if (!version) {
    throw new Error(`\`${program} --version\` printed no version: ${stdout}`)
  }

  return `${name} ${version}`
}

/**
 * Every email, home folder, macOS temp folder and account id in a directory of
 * recordings that is not one of `standIns`, as `file:line found`.
 */
export function privateDetailsIn(directory: string, standIns: string[]) {
  return fs
    .readdirSync(directory)
    .filter(name => name.endsWith('.ndjson'))
    .flatMap(name =>
      fs
        .readFileSync(path.join(directory, name), 'utf8')
        .split('\n')
        .flatMap((line, at) =>
          [
            ...line.matchAll(EMAIL),
            ...line.matchAll(HOME),
            ...line.matchAll(ID),
            ...line.matchAll(MAC_TEMP),
          ].flatMap(match =>
            standIns.includes(match[1] ?? match[0])
              ? []
              : [`${name}:${at + 1} ${match[0]}`]
          )
        )
    )
}
