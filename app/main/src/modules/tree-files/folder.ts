import fs from 'node:fs'
import path from 'node:path'

export function treesFolderOf(userData: string) {
  return path.join(userData, 'trees')
}

export function storesFolderOf(userData: string) {
  return path.join(userData, 'tree-stores')
}

/** Made if missing: both vendor programs need their `cwd` to exist. */
export function makeTreeFolder(userData: string, treeId: string) {
  const folder = path.join(treesFolderOf(userData), treeId)
  fs.mkdirSync(folder, {recursive: true, mode: 0o700})

  return folder
}
