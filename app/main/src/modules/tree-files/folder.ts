import fs from 'node:fs'
import path from 'node:path'

/** Made if missing: both vendor programs need their `cwd` to exist. */
export function makeTreeFolder(userData: string, treeId: string) {
  const folder = path.join(userData, 'trees', treeId)
  fs.mkdirSync(folder, {recursive: true, mode: 0o700})

  return folder
}
