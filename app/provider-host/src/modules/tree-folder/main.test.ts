import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {isInTreeFolder} from './main'

const made: string[] = []

function newFolder() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-tree-folder-'))
  made.push(folder)

  return folder
}

afterEach(() => {
  for (const folder of made.splice(0)) {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

it('counts a file not yet written inside the folder, by a relative path too', () => {
  const tree = newFolder()

  expect(isInTreeFolder(tree, path.join(tree, 'new', 'notes.txt'))).toBe(true)
  expect(isInTreeFolder(tree, 'notes.txt')).toBe(true)
})

it('counts a file whose name starts with two dots as inside', () => {
  const tree = newFolder()

  expect(isInTreeFolder(tree, path.join(tree, '..notes'))).toBe(true)
})

it('counts the folder itself and anything beside it as outside', () => {
  const tree = newFolder()

  expect(isInTreeFolder(tree, tree)).toBe(false)
  expect(isInTreeFolder(tree, path.join(tree, '..', 'elsewhere.txt'))).toBe(
    false
  )
})

it('agrees when one path goes through a link to the other', () => {
  const tree = newFolder()
  const link = path.join(newFolder(), 'link')
  fs.symlinkSync(tree, link)

  expect(isInTreeFolder(link, path.join(tree, 'notes.txt'))).toBe(true)
  expect(isInTreeFolder(tree, path.join(link, 'notes.txt'))).toBe(true)
})
