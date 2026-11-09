import fs from 'node:fs'
import path from 'node:path'

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g

const HOME = /(?:\/(?:Users|home)\/|-(?:Users|home)-)[^/"\\\s-]+/g

// The backslashes match a key inside JSON that a recorded string holds.
const ID =
  /(?:account_?id|user_?id|installation_?id|(?:organization|account)_?uuid)\\*":\\*"([^"\\]*)/gi

/**
 * Every email, home folder and account id in a directory of recordings that is
 * not one of `standIns`, as `file:line found`.
 */
export function accountDetailsIn(directory: string, standIns: string[]) {
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
          ].flatMap(match =>
            standIns.includes(match[1] ?? match[0])
              ? []
              : [`${name}:${at + 1} ${match[0]}`]
          )
        )
    )
}
