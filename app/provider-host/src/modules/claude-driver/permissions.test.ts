import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {actionOf} from './permissions'

const made: string[] = []

afterEach(() => {
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
