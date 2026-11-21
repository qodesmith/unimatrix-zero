import type {VersionedFolder} from './store'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, expect, it} from 'vitest'

import {createGit} from './git'
import {changedFiles, storeExists, takeSnapshot} from './store'
import {removeFolder} from './test-cleanup'

let root: string
let copy: VersionedFolder
let git: ReturnType<typeof createGit>

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-tree-files-'))
  copy = {
    store: path.join(root, 'store.git'),
    folder: path.join(root, 'folder'),
    index: path.join(root, 'store.git', 'uz-index'),
  }
  fs.mkdirSync(copy.folder)
  git = createGit(process.env)
})

afterEach(() => {
  removeFolder(root)
})

function write(name: string, text: string) {
  const file = path.join(copy.folder, name)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)
}

async function snapshot(replyId: string, parent: string | null) {
  return takeSnapshot(git, copy, {replyId, parent})
}

/** Every file a Snapshot holds, by path. */
async function filesIn(commit: string) {
  const listed = await git({store: copy.store}, [
    'ls-tree',
    '-r',
    '--name-only',
    '-z',
    commit,
  ])

  return listed.split('\0').filter(Boolean)
}

async function contentAt(commit: string, name: string) {
  return git({store: copy.store}, ['cat-file', 'blob', `${commit}:${name}`])
}

it('keeps the files as they stood at each Reply, under a ref of that Reply’s own', async () => {
  write('notes.md', 'first')
  const first = await snapshot('reply-1', null)

  write('notes.md', 'second')
  write('src/app.ts', 'export {}')
  const second = await snapshot('reply-2', first)

  expect(await contentAt(first, 'notes.md')).toBe('first')
  expect(await filesIn(first)).toEqual(['notes.md'])
  expect(await contentAt(second, 'notes.md')).toBe('second')
  expect(await filesIn(second)).toEqual(['notes.md', 'src/app.ts'])

  const refs = await git({store: copy.store}, [
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  ])

  expect(refs.trim().split('\n')).toEqual([
    `refs/uz/replies/reply-1 ${first}`,
    `refs/uz/replies/reply-2 ${second}`,
  ])
})

it('gives a Reply that changed nothing its parent’s Snapshot, and writes no ref for it', async () => {
  write('notes.md', 'first')
  const first = await snapshot('reply-1', null)

  expect(await snapshot('reply-2', first)).toBe(first)

  const refs = await git({store: copy.store}, [
    'for-each-ref',
    '--format=%(refname)',
  ])

  expect(refs.trim()).toBe('refs/uz/replies/reply-1')
})

it('lists what each Reply created, edited and deleted, with the size it left each file at', async () => {
  write('kept.md', 'same')
  write('gone.md', 'bye')
  write('sub/é b.md', 'one')
  const first = await snapshot('reply-1', null)

  fs.rmSync(path.join(copy.folder, 'gone.md'))
  write('sub/é b.md', 'three!')
  write('new.txt', '12345')
  const second = await snapshot('reply-2', first)

  const changed = await changedFiles(git, copy.store, [
    {replyId: 'reply-1', from: null, to: first},
    {replyId: 'unchanged', from: first, to: first},
    {replyId: 'reply-2', from: first, to: second},
  ])

  expect(changed.get('reply-1')).toEqual([
    {path: 'gone.md', change: 'created', size: 3},
    {path: 'kept.md', change: 'created', size: 4},
    {path: 'sub/é b.md', change: 'created', size: 3},
  ])
  expect(changed.has('unchanged')).toBe(false)
  expect(changed.get('reply-2')).toEqual([
    {path: 'gone.md', change: 'deleted', size: null},
    {path: 'new.txt', change: 'created', size: 5},
    {path: 'sub/é b.md', change: 'edited', size: 6},
  ])
})

it.skipIf(process.platform === 'win32')(
  'lists no file whose mode alone changed',
  async () => {
    write('run.sh', 'echo hi')
    write('notes.md', 'first')
    const first = await snapshot('reply-1', null)

    fs.chmodSync(path.join(copy.folder, 'run.sh'), 0o755)
    write('notes.md', 'second')
    const second = await snapshot('reply-2', first)

    const changed = await changedFiles(git, copy.store, [
      {replyId: 'reply-2', from: first, to: second},
    ])

    expect(changed.get('reply-2')).toEqual([
      {path: 'notes.md', change: 'edited', size: 6},
    ])
  }
)

it('lists the files beside a folder that is a git repository of its own, and nothing for that folder', async () => {
  const nested = {store: path.join(copy.folder, 'vendor/lib/.git')}
  write('vendor/lib/readme.md', 'theirs')
  write('notes.md', 'mine')
  await git(nested, ['init', '--quiet'])
  const tree = await git(nested, ['write-tree'])
  const head = await git(nested, ['commit-tree', tree.trim(), '-m', 'theirs'])
  await git(nested, ['update-ref', 'HEAD', head.trim()])

  const first = await snapshot('reply-1', null)

  const changed = await changedFiles(git, copy.store, [
    {replyId: 'reply-1', from: null, to: first},
  ])

  expect(changed.get('reply-1')).toEqual([
    {path: 'notes.md', change: 'created', size: 4},
  ])
})

it('puts the store, its index and nothing of git’s in the folder the AI works in', async () => {
  write('notes.md', 'first')
  await snapshot('reply-1', null)

  expect(fs.readdirSync(copy.folder)).toEqual(['notes.md'])
  expect(storeExists(copy.store)).toBe(true)
  expect(fs.existsSync(copy.index)).toBe(true)
})

it('leaves out the default excludes and what the folder’s own .gitignore files name, at any depth', async () => {
  write('notes.md', 'kept')
  write('node_modules/left-pad/index.js', 'module.exports = 1')
  write('app/.venv/bin/python', '#!')
  write('app/dist/out.js', '1')
  write('.gitignore', '*.log\n')
  write('debug.log', 'noise')
  write('app/.gitignore', 'secret.txt\n')
  write('app/secret.txt', 'hush')
  write('app/main.py', 'print(1)')

  expect(await filesIn(await snapshot('reply-1', null))).toEqual([
    '.gitignore',
    'app/.gitignore',
    'app/main.py',
    'notes.md',
  ])
})

/** A home whose git config ignores Markdown and runs a hook on every ref. */
function hostileHome() {
  const home = path.join(root, 'home')
  const hooks = path.join(home, 'hooks')
  const ran = path.join(root, 'hook-ran')
  fs.mkdirSync(hooks, {recursive: true})
  fs.writeFileSync(path.join(home, 'ignore'), '*.md\n')
  fs.writeFileSync(
    path.join(home, '.gitconfig'),
    `[core]\n\thooksPath = ${hooks}\n\texcludesFile = ${path.join(home, 'ignore')}\n\tfsmonitor = ${path.join(hooks, 'reference-transaction')}\n`
  )
  fs.writeFileSync(
    path.join(hooks, 'reference-transaction'),
    `#!/bin/sh\necho ran > "${ran}"\n`,
    {mode: 0o755}
  )

  return {home, ran, hooks}
}

it('reads no global or system config, takes no git variable from the app’s own environment and runs no hook, the store’s own included', async () => {
  const {home, ran, hooks} = hostileHome()
  git = createGit({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_OBJECT_DIRECTORY: path.join(root, 'elsewhere'),
  })

  write('notes.md', 'first')
  const first = await snapshot('reply-1', null)

  fs.cpSync(hooks, path.join(copy.store, 'hooks'), {recursive: true})
  write('notes.md', 'second')
  const second = await snapshot('reply-2', first)

  expect(await filesIn(second)).toEqual(['notes.md'])
  expect(fs.existsSync(ran)).toBe(false)
  expect(fs.existsSync(path.join(root, 'elsewhere'))).toBe(false)
})
