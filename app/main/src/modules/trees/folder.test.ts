import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {makeTreeFolder} from './folder'

const made: string[] = []

afterEach(() => {
  for (const folder of made.splice(0)) {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

function userData() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-user-data-'))
  made.push(folder)

  return folder
}

it('makes one folder per Tree in userData, and keeps what it already holds', () => {
  const data = userData()
  const first = makeTreeFolder(data, 'tree-a')
  fs.writeFileSync(path.join(first, 'notes.md'), 'kept')

  expect(makeTreeFolder(data, 'tree-a')).toBe(first)
  expect(fs.readFileSync(path.join(first, 'notes.md'), 'utf8')).toBe('kept')
  expect(makeTreeFolder(data, 'tree-b')).not.toBe(first)
  expect(fs.statSync(makeTreeFolder(data, 'tree-b')).isDirectory()).toBe(true)
  expect(path.dirname(first).startsWith(data)).toBe(true)
})
