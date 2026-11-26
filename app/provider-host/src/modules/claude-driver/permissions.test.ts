import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {actionOf, readDecision} from './permissions'

const made: string[] = []

afterEach(() => {
  vi.restoreAllMocks()

  for (const folder of made.splice(0)) {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

/** Under the temporary folder as the OS names it, `/var` on a Mac. */
function treeFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-tree-'))
  made.push(folder)

  return folder
}

function trees() {
  const treesFolder = treeFolder()
  const tree = path.join(treesFolder, 'one')
  const other = path.join(treesFolder, 'two')
  fs.mkdirSync(tree)
  fs.mkdirSync(other)

  return {folders: {treeFolder: tree, treesFolder}, treesFolder, tree, other}
}

it('asks about an edit in the Tree’s files by its full path, a relative one too, and one through the real path of the folder', () => {
  const tree = treeFolder()
  const real = fs.realpathSync(tree)

  expect(actionOf('Write', {file_path: 'notes.txt'}, tree)).toEqual({
    kind: 'edit',
    paths: [path.join(tree, 'notes.txt')],
    inTreeFiles: true,
  })
  expect(
    actionOf('Edit', {file_path: path.join(real, 'deep', 'a.md')}, tree)
  ).toMatchObject({inTreeFiles: true})
  expect(
    actionOf('NotebookEdit', {notebook_path: path.join(tree, 'a.ipynb')}, tree)
  ).toMatchObject({kind: 'edit', inTreeFiles: true})
})

it('asks about an edit outside the Tree’s files as one other Branches will see', () => {
  const tree = treeFolder()
  const zshrc = path.join(os.homedir(), '.zshrc')

  expect(actionOf('Write', {file_path: zshrc}, tree)).toEqual({
    kind: 'edit',
    paths: [zshrc],
    inTreeFiles: false,
  })
  expect(
    actionOf('Edit', {file_path: path.join(tree, '..', 'x.txt')}, tree)
  ).toMatchObject({inTreeFiles: false})
})

it('asks about an edit by a `~` path, or one with a space before it, as the file `claude` would write', () => {
  const tree = treeFolder()
  const home = treeFolder()
  vi.spyOn(os, 'homedir').mockReturnValue(home)

  expect(actionOf('Write', {file_path: '~/.zshrc'}, tree)).toEqual({
    kind: 'edit',
    paths: [path.join(home, '.zshrc')],
    inTreeFiles: false,
  })
  expect(
    actionOf('NotebookEdit', {notebook_path: ` ${home}/a.ipynb`}, tree)
  ).toEqual({
    kind: 'edit',
    paths: [path.join(home, 'a.ipynb')],
    inTreeFiles: false,
  })
})

it('asks about a command, a host, an MCP tool and any other tool by what each names', () => {
  const tree = treeFolder()

  expect(actionOf('Bash', {command: 'touch made.txt'}, tree)).toEqual({
    kind: 'command',
    command: 'touch made.txt',
  })
  expect(actionOf('PowerShell', {command: 'ni made.txt'}, tree)).toEqual({
    kind: 'command',
    command: 'ni made.txt',
  })
  expect(
    actionOf('WebFetch', {url: 'https://docs.example.com:8443/a?b'}, tree)
  ).toEqual({kind: 'host', host: 'docs.example.com'})
  expect(actionOf('mcp__linear_app__create_issue', {}, tree)).toEqual({
    kind: 'mcp-tool',
    server: 'linear_app',
    tool: 'create_issue',
  })
  expect(actionOf('WebSearch', {}, tree)).toEqual({
    kind: 'tool',
    name: 'WebSearch',
  })
})

it('asks about the retry of a command outside the Sandbox as that form alone, and about the Sandbox’s network prompt by its host', () => {
  const tree = treeFolder()

  expect(
    actionOf(
      'Bash',
      {command: 'touch ../made.txt', dangerouslyDisableSandbox: true},
      tree
    )
  ).toEqual({
    kind: 'command',
    command: 'touch ../made.txt',
    outsideSandbox: true,
  })
  expect(
    actionOf(
      'Bash',
      {command: 'touch made.txt', dangerouslyDisableSandbox: false},
      tree
    )
  ).toEqual({kind: 'command', command: 'touch made.txt'})
  expect(actionOf('SandboxNetworkAccess', {host: 'example.com'}, tree)).toEqual(
    {kind: 'host', host: 'example.com'}
  )
})

it('refuses a Read, a Glob and a Grep of another Tree’s files, by a relative path and a Glob pattern too, and lets through one of this Tree’s files or outside every Tree', () => {
  const {folders, tree, other} = trees()
  const beside = treeFolder()

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders).permissionDecision
  }

  expect([
    decided('Read', {file_path: path.join(other, 'secret.txt')}),
    decided('Read', {file_path: path.join('..', 'two', 'secret.txt')}),
    decided('Read', {file_path: path.join(fs.realpathSync(other), 'a.txt')}),
    decided('Glob', {pattern: '*.txt', path: other}),
    decided('Glob', {pattern: path.join(other, '**')}),
    decided('Glob', {pattern: path.join('*', '..', '..', 'two', '**')}),
    decided('Grep', {pattern: 'PLOVER', path: other}),
  ]).toEqual(Array.from({length: 7}, () => 'deny'))

  expect([
    decided('Read', {file_path: path.join(tree, 'notes.txt')}),
    decided('Read', {file_path: 'notes.txt'}),
    decided('Read', {file_path: path.join(os.homedir(), '.zshrc')}),
    decided('Glob', {pattern: '**/*.txt'}),
    decided('Glob', {pattern: '*.txt', path: tree}),
    decided('Glob', {pattern: path.join(tree, 'src', '{a,b}', '*.ts')}),
    decided('Glob', {pattern: '*.txt', path: beside}),
    decided('Grep', {pattern: '../two'}),
    decided('Grep', {pattern: 'PLOVER', path: beside}),
  ]).toEqual(Array.from({length: 9}, () => 'allow'))
})

it.runIf(fs.existsSync(os.tmpdir().toUpperCase()))(
  'refuses a Read, a Glob and a Grep of another Tree’s files through a folder’s name in another letter case, on a disk that ignores case',
  () => {
    const {folders, treesFolder} = trees()

    const other = path.join(
      path.dirname(treesFolder),
      path.basename(treesFolder).toUpperCase(),
      'two'
    )

    function decided(toolName: string, input: Record<string, string>) {
      return readDecision(toolName, input, folders).permissionDecision
    }

    expect([
      decided('Read', {file_path: path.join(other, 'secret.txt')}),
      decided('Glob', {pattern: '*.txt', path: other}),
      decided('Grep', {pattern: 'PLOVER', path: other}),
    ]).toEqual(['deny', 'deny', 'deny'])
  }
)

it('refuses a Read, a Glob and a Grep that reach another Tree through a `~` path or a path with a space before it', () => {
  const {folders, treesFolder, other} = trees()
  vi.spyOn(os, 'homedir').mockReturnValue(path.dirname(treesFolder))
  const fromHome = `~/${path.basename(treesFolder)}/two`

  function decided(toolName: string, input: Record<string, string>) {
    return readDecision(toolName, input, folders).permissionDecision
  }

  expect([
    decided('Read', {file_path: `${fromHome}/secret.txt`}),
    decided('Glob', {pattern: '*.txt', path: fromHome}),
    decided('Grep', {pattern: 'PLOVER', path: fromHome}),
    decided('Grep', {pattern: 'PLOVER', path: '~'}),
    decided('Read', {file_path: ` ${path.join(other, 'secret.txt')}`}),
    decided('Grep', {pattern: 'PLOVER', path: ` ${treesFolder}`}),
  ]).toEqual(Array.from({length: 6}, () => 'deny'))
})

it('refuses a Glob and a Grep that start at or above the folder of every Tree, by a pattern with a wildcard above it too, and tells the Model to search a narrower folder', () => {
  const {folders, treesFolder} = trees()
  const above = path.dirname(treesFolder)
  const {root} = path.parse(treesFolder)

  expect([
    readDecision('Grep', {pattern: 'PLOVER', path: treesFolder}, folders),
    readDecision('Grep', {pattern: 'PLOVER', path: above}, folders),
    readDecision('Grep', {pattern: 'PLOVER', path: root}, folders),
    readDecision('Glob', {pattern: '**/secret.txt', path: above}, folders),
    readDecision('Glob', {pattern: '**', path: root}, folders),
    readDecision('Glob', {pattern: path.join('..', '**')}, folders),
    readDecision('Glob', {pattern: path.join('..', '..', '*')}, folders),
    readDecision(
      'Glob',
      {pattern: path.join(above, 'uz-tr*', '**', 'secret.txt')},
      folders
    ),
    readDecision(
      'Glob',
      {pattern: path.join(above, `{${path.basename(treesFolder)},x}`, '**')},
      folders
    ),
  ]).toEqual(
    Array.from({length: 9}, () => ({
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('narrower folder'),
    }))
  )
})
