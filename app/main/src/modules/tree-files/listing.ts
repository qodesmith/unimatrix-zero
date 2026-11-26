import type {Git} from './git'
import type {TreeFile} from '@uz/contract/tree-files'

interface Entry {
  mode: string
  blob: string
  size: number
}

export interface ListedFile extends Entry {
  path: string
  change: TreeFile['change']
}

/** `<mode> blob <object> <size>\t<path>`, the size padded with spaces. */
const LONG_ENTRY = /^(\d+) blob ([\da-f]+) +(\d+)\t(.+)$/su

async function entriesOf(git: Git, store: string, commit: string | null) {
  if (commit === null) return new Map<string, Entry>()

  const output = await git({store}, ['ls-tree', '-r', '-z', '--long', commit])

  return new Map(
    output.split('\0').flatMap(line => {
      const [, mode, blob, size, filePath] = LONG_ENTRY.exec(line) ?? []

      return mode && blob && size && filePath
        ? [[filePath, {mode, blob, size: Number(size)}] as const]
        : []
    })
  )
}

/**
 * As `changedFiles` decides: a file whose mode alone changed has the same
 * contents, so the Reply left it as it was.
 */
function changeOf(entry: Entry, before: Entry | undefined): TreeFile['change'] {
  if (!before) return 'created'

  return before.blob === entry.blob ? null : 'edited'
}

/** `parent` null is no files at all; `own` false lists `commit` unchanged. */
export async function listSnapshot(
  git: Git,
  store: string,
  {commit, parent, own}: {commit: string; parent: string | null; own: boolean}
): Promise<ListedFile[]> {
  const [entries, parentEntries] = await Promise.all([
    entriesOf(git, store, commit),
    own ? entriesOf(git, store, parent) : new Map<string, Entry>(),
  ])

  const kept = [...entries].map(([filePath, {mode, blob, size}]) => ({
    mode,
    blob,
    size,
    path: filePath,
    change: own
      ? changeOf({mode, blob, size}, parentEntries.get(filePath))
      : null,
  }))

  const deleted = [...parentEntries].flatMap(([filePath, entry]) =>
    entries.has(filePath)
      ? []
      : [{...entry, path: filePath, change: 'deleted' as const}]
  )

  return [...kept, ...deleted].toSorted((a, b) =>
    a.path < b.path ? -1 : Number(a.path > b.path)
  )
}
