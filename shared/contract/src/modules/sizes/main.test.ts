import {describe, expect, it} from 'vitest'

import {formatSize} from './main'

describe('formatSize', () => {
  it.each([
    ['one byte in the singular', 1, '1 byte'],
    ['a value under 10 to one decimal', 2458, '2.4 KiB'],
    ['a value of 10 or more as a whole number', 19_293_799, '18 MiB'],
    ['a size past 1024 GiB still in GiB', 2048 * 1024 ** 3, '2048 GiB'],
  ])('says %s', (_case, bytes, said) => {
    expect(formatSize(bytes)).toBe(said)
  })
})
