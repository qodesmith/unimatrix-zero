import {expect, it} from 'vitest'

import runtime from '../electron-runtime.json'

it('runs under the Node that Electron ships', () => {
  expect(process.versions.electron).toBe(runtime.electron)
  expect(process.versions.node).toBe(runtime.node)
})
