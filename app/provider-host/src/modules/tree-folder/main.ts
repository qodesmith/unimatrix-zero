import fs from 'node:fs'
import path from 'node:path'

/** Through the nearest folder that exists, so `/var` and `/private/var` agree. */
function realPath(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    const parent = path.dirname(target)

    return parent === target
      ? target
      : path.join(realPath(parent), path.basename(target))
  }
}

/**
 * Whether an edit to `file` lands in the Tree's files, which each Branch
 * versions.
 */
export function isInTreeFolder(treeFolder: string, file: string) {
  const relative = path.relative(
    realPath(treeFolder),
    realPath(path.resolve(treeFolder, file))
  )

  return (
    relative !== '' &&
    relative.split(path.sep)[0] !== '..' &&
    !path.isAbsolute(relative)
  )
}
