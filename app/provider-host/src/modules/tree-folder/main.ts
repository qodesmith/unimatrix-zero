import fs from 'node:fs'
import path from 'node:path'

/**
 * Through the nearest folder that exists, so `/var` and `/private/var` agree.
 * Only `native` returns the letter case on disk: Node's own keeps the case
 * it was given.
 */
export function realPath(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    const parent = path.dirname(target)

    return parent === target
      ? target
      : path.join(realPath(parent), path.basename(target))
  }
}

export function namesBelow(folder: string, file: string) {
  const relative = path.relative(realPath(folder), realPath(file))
  const names = relative === '' ? [] : relative.split(path.sep)

  return names[0] === '..' || path.isAbsolute(relative) ? null : names
}

export function isAtOrUnder(folder: string, file: string) {
  return namesBelow(folder, file) !== null
}

export function isInTreeFolder(treeFolder: string, file: string) {
  const absolute = path.resolve(treeFolder, file)

  return (
    isAtOrUnder(treeFolder, absolute) &&
    realPath(absolute) !== realPath(treeFolder)
  )
}

/**
 * Whether `file`, read from the Tree's folder, is another Tree's: anything
 * in the folder that holds every Tree's files but this Tree's own.
 */
export function isInAnotherTree(
  {treeFolder, treesFolder}: {treeFolder: string; treesFolder: string},
  file: string
) {
  const absolute = path.resolve(treeFolder, file)

  return (
    isAtOrUnder(treesFolder, absolute) && !isAtOrUnder(treeFolder, absolute)
  )
}

export function isHidden(
  {treeFolder, hiddenFolders}: {treeFolder: string; hiddenFolders: string[]},
  file: string
) {
  const absolute = path.resolve(treeFolder, file)

  return hiddenFolders.some(folder => isAtOrUnder(folder, absolute))
}

/**
 * Whether `file`, read from the Tree's folder, is one the AI may never change:
 * another Tree's, or in one of the app's hidden folders.
 */
export function isOffLimits(
  folders: {treeFolder: string; treesFolder: string; hiddenFolders: string[]},
  file: string
) {
  return isInAnotherTree(folders, file) || isHidden(folders, file)
}

/**
 * Whether a search that starts at `folder` would reach other Trees' files:
 * `folder` is the one that holds every Tree's files, or one above it.
 */
export function holdsEveryTree(
  {treeFolder, treesFolder}: {treeFolder: string; treesFolder: string},
  folder: string
) {
  return isAtOrUnder(path.resolve(treeFolder, folder), treesFolder)
}

export function holdsHiddenFolder(
  {treeFolder, hiddenFolders}: {treeFolder: string; hiddenFolders: string[]},
  folder: string
) {
  const searched = path.resolve(treeFolder, folder)

  return hiddenFolders.some(hidden => isAtOrUnder(searched, hidden))
}

export function otherTreeFolders({
  treeFolder,
  treesFolder,
}: {
  treeFolder: string
  treesFolder: string
}) {
  const names = namesBelow(treesFolder, treeFolder)

  if (names === null) return [treesFolder]

  return fs
    .readdirSync(treesFolder)
    .filter(name => name !== names[0])
    .toSorted()
    .map(name => path.join(treesFolder, name))
}
