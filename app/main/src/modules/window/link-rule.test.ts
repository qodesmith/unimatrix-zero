import {expect, it} from 'vitest'

import {isOpenableExternally} from './link-rule'

it.each(['https://example.com/x', 'http://example.com', 'mailto:a@b.c'])(
  'opens %s in the default browser',
  url => {
    expect(isOpenableExternally(url)).toBe(true)
  }
)

it.each([
  'file:///etc/passwd',
  'vscode://file/x',
  'ms-msdt:/id',
  'javascript:alert(1)',
  'not a url',
])('never hands %s to the OS', url => {
  expect(isOpenableExternally(url)).toBe(false)
})
