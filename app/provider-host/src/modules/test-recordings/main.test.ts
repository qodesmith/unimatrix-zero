import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {claimRecordings, replaceAcross} from './main'

it('replaces a path that streamed pieces split, keeping each piece in its place', () => {
  const pieces = [
    '{"file_path": "/private/var/',
    'folders/47/6',
    'jxrn/T/uz-live-hidden-1/secret.txt',
    '"}',
  ]

  expect(
    replaceAcross(pieces, '/private/var/folders/47/6jxrn/T', '/temp-folder')
  ).toEqual([
    '{"file_path": "/temp-folder',
    '',
    '/uz-live-hidden-1/secret.txt',
    '"}',
  ])
})

it('replaces every match, and leaves pieces with none as they were', () => {
  expect(replaceAcross(['ab', 'cab', 'c', 'xyz'], 'abc', 'X')).toEqual([
    'X',
    'X',
    '',
    'xyz',
  ])
})

describe('a claim on recordings', () => {
  let folder = ''

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-claims-'))
  })

  afterEach(() => {
    fs.rmSync(folder, {recursive: true, force: true})
  })

  function written() {
    return Object.fromEntries(
      fs
        .readdirSync(folder)
        .map(name => [name, fs.readFileSync(path.join(folder, name), 'utf8')])
    )
  }

  it('writes the file of a recorder that alone claimed it', () => {
    const file = path.join(folder, 'lone.ndjson')
    const write = claimRecordings([file])

    write(file, 'lone')

    expect(written()).toEqual({'lone.ndjson': 'lone'})
  })

  it('writes nothing for a recorder that finishes after a newer one claimed its file, before the newer one writes or after', () => {
    const file = path.join(folder, 'retried.ndjson')
    const older = claimRecordings([file])
    const newer = claimRecordings([file])

    older(file, 'first try, early')

    expect(written()).toEqual({})

    newer(file, 'retry')
    older(file, 'first try, late')

    expect(written()).toEqual({'retried.ndjson': 'retry'})
  })

  it('keeps an older recorder’s claim on each file no newer one claimed', () => {
    const first = path.join(folder, 'first.ndjson')
    const second = path.join(folder, 'second.ndjson')
    const other = path.join(folder, 'other.ndjson')

    const older = claimRecordings([first, second])
    const newer = claimRecordings([first])
    const apart = claimRecordings([other])

    older(first, 'older')
    older(second, 'older')
    newer(first, 'newer')
    apart(other, 'apart')

    expect(written()).toEqual({
      'first.ndjson': 'newer',
      'second.ndjson': 'older',
      'other.ndjson': 'apart',
    })
  })
})
