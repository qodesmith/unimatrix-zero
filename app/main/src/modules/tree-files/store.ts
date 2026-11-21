import type {Git} from './git'
import type {ChangedFile} from '@uz/contract/turns'

import fs from 'node:fs'
import path from 'node:path'

/**
 * Never in a Snapshot, whatever the folder's own `.gitignore` files say: one
 * `node_modules` is hundreds of thousands of files.
 */
const DEFAULT_EXCLUDES = [
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  'dist/',
  'build/',
  'target/',
  '.next/',
  '.DS_Store',
]

/** The tree git gives a folder with no files, in a SHA-1 store. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** One Thread's files on disk, and the hidden store that keeps its Snapshots. */
export interface WorkingCopy {
  store: string
  folder: string
  /** Its own index, kept in the store between Snapshots. */
  index: string
}

export function storeExists(store: string) {
  return fs.existsSync(path.join(store, 'HEAD'))
}

/** A bare store with no template, so it starts with no hook of any kind. */
async function makeStore(git: Git, store: string) {
  fs.mkdirSync(store, {recursive: true, mode: 0o700})
  await git({store}, ['init', '--bare', '--quiet', '--template=', store])
  fs.mkdirSync(path.join(store, 'info'), {recursive: true})
  fs.writeFileSync(
    path.join(store, 'info', 'exclude'),
    `${DEFAULT_EXCLUDES.join('\n')}\n`
  )
}

function oneLine(output: string) {
  return output.trim()
}

/**
 * The Working copy as it stands, as a commit of its own under the Reply's ref,
 * or `parent` again when nothing differs from it. The index is the copy's own
 * and persists, so git re-hashes only the files whose size or modified time
 * changed since the last Snapshot.
 */
export async function takeSnapshot(
  git: Git,
  {store, folder, index}: WorkingCopy,
  {replyId, parent}: {replyId: string; parent: string | null}
): Promise<string> {
  if (!storeExists(store)) await makeStore(git, store)

  fs.mkdirSync(path.dirname(index), {recursive: true})

  const copy = {store, workingCopy: {folder, index}}

  await git(copy, ['add', '--all', '--', '.'])

  const tree = oneLine(await git(copy, ['write-tree']))

  const parentTree =
    parent && oneLine(await git({store}, ['rev-parse', `${parent}^{tree}`]))

  if (parent && tree === parentTree) return parent

  const commit = oneLine(
    await git({store}, ['commit-tree', tree, '-m', `Reply ${replyId}`])
  )

  await git({store}, ['update-ref', `refs/uz/replies/${replyId}`, commit])

  return commit
}

/** A Reply's Snapshot and its parent's; a null `from` is no files at all. */
export interface SnapshotPair {
  replyId: string
  from: string | null
  to: string
}

/** By git's status letter; a `T` is a file that became a link, or the reverse. */
function changeOf(status: string | undefined): ChangedFile['change'] | null {
  if (status === 'A') return 'created'

  if (status === 'M' || status === 'T') return 'edited'

  return status === 'D' ? 'deleted' : null
}

interface RawChange {
  path: string
  change: ChangedFile['change']
  /** The file's contents after the change. */
  blob: string
}

/**
 * `diff-tree --stdin -z` answers each pair of trees with a line naming them,
 * then one `:modes old new status`, NUL, path, NUL per file. The next pair's
 * line follows the last NUL directly, in the same field as its first file.
 */
function parseDiffs(output: string): RawChange[][] {
  const perPair: RawChange[][] = []
  const fields = output.split('\0')

  for (let at = 0; at < fields.length; at += 2) {
    const lines = (fields[at] ?? '').split('\n')
    const record = lines.pop() ?? ''

    for (const _pair of lines) perPair.push([])

    const [, , , blob, status] = record.split(' ')
    const change = changeOf(status)
    const filePath = fields[at + 1]

    if (blob && change && filePath) {
      perPair.at(-1)?.push({path: filePath, change, blob})
    }
  }

  return perPair
}

async function treesOf(git: Git, store: string, commits: string[]) {
  const output = await git(
    {store},
    ['cat-file', '--batch-check=%(objectname)'],
    commits.map(commit => `${commit}^{tree}\n`).join('')
  )

  const trees = output.split('\n')

  return new Map(commits.map((commit, at) => [commit, trees[at] ?? '']))
}

async function sizesOf(git: Git, store: string, blobs: string[]) {
  if (blobs.length === 0) return new Map<string, number>()

  const output = await git(
    {store},
    ['cat-file', '--batch-check=%(objectsize)'],
    blobs.map(blob => `${blob}\n`).join('')
  )

  const sizes = output.split('\n')

  return new Map(blobs.map((blob, at) => [blob, Number(sizes[at])]))
}

/**
 * What each Reply changed, by Reply id, in three `git` runs however many pairs
 * there are. A Reply with no changes has no entry.
 */
export async function changedFiles(
  git: Git,
  store: string,
  pairs: SnapshotPair[]
): Promise<Map<string, ChangedFile[]>> {
  if (pairs.length === 0) return new Map()

  const commits = [
    ...new Set(pairs.flatMap(({from, to}) => (from ? [from, to] : [to]))),
  ]

  const trees = await treesOf(git, store, commits)

  const diffs = parseDiffs(
    await git(
      {store},
      ['diff-tree', '-r', '--no-renames', '--raw', '-z', '--stdin'],
      pairs
        .map(({from, to}) => {
          const before = from ? trees.get(from) : EMPTY_TREE

          return `${before} ${trees.get(to)}\n`
        })
        .join('')
    )
  )

  const sizes = await sizesOf(git, store, [
    ...new Set(
      diffs.flatMap(diff =>
        diff.flatMap(({change, blob}) => (change === 'deleted' ? [] : [blob]))
      )
    ),
  ])

  return new Map(
    pairs.flatMap(({replyId}, at) => {
      const files = (diffs[at] ?? []).map(({path: filePath, change, blob}) => ({
        path: filePath,
        change,
        size: change === 'deleted' ? null : (sizes.get(blob) ?? null),
      }))

      return files.length > 0 ? [[replyId, files] as const] : []
    })
  )
}
