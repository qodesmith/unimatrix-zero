import fs from 'node:fs'
import path from 'node:path'

/** Git writes objects read-only, and Windows won't delete a read-only file. */
export function removeFolder(folder: string) {
  const entries = fs.readdirSync(folder, {recursive: true, withFileTypes: true})

  for (const entry of entries) {
    if (entry.isFile()) {
      fs.chmodSync(path.join(entry.parentPath, entry.name), 0o600)
    }
  }

  fs.rmSync(folder, {recursive: true, force: true})
}
