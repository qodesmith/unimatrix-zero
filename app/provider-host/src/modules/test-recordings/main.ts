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

function asProjectKey(folder: string) {
  return folder.replaceAll(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Each way a recording can name this machine's temp folder, with its stand-in,
 * the real path first since the other can sit inside it.
 */
export function tempFolderNames() {
  const folders = [fs.realpathSync(os.tmpdir()), os.tmpdir()].map(folder =>
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
