import fs from 'node:fs'
import path from 'node:path'

/**
 * The Tree's own folder in `userData`, made if missing: both vendor programs
 * need their `cwd` to exist as a session starts.
 */
export function makeTreeFolder(userData: string, treeId: string) {
  const folder = path.join(userData, 'trees', treeId)
  fs.mkdirSync(folder, {recursive: true, mode: 0o700})

  return folder
}
