import {expect, it} from 'vitest'

import {replaceAcross} from './main'

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
