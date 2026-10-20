import path from 'node:path'
import {expect, it} from 'vitest'

import {resolveBundleFile} from './bundle-file'

const dir = path.resolve('/bundle')

it('serves index.html for the root and any extensionless path', () => {
  expect(resolveBundleFile(dir, '/')?.filePath).toBe(
    path.join(dir, 'index.html')
  )
  expect(resolveBundleFile(dir, '/trees/abc')?.filePath).toBe(
    path.join(dir, 'index.html')
  )
})

it('serves assets with a fixed MIME type', () => {
  expect(resolveBundleFile(dir, '/assets/app.js')).toEqual({
    filePath: path.join(dir, 'assets', 'app.js'),
    mimeType: 'text/javascript; charset=utf-8',
  })
})

it.each([
  '/../secret',
  '/%2e%2e/secret',
  '/a/..%2Fb.js',
  '/x%00.js',
  '/evil.exe',
])('refuses %s', pathname => {
  expect(resolveBundleFile(dir, pathname)).toBeNull()
})
