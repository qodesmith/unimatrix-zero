import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/module-boundaries', () => {
  const diagnostics = lintFixture(['uz/module-boundaries'], {
    'src/modules/a/entry.ts': "export {b} from '#modules/b/main'\n",
    'src/modules/a/private.ts': "export {b} from '#modules/b/private'\n",
    'src/modules/a/relative.ts': "export {b} from '../b/private'\n",
    'src/modules/a/dynamic.ts':
      "export const b = import('#modules/b/private')\n",
    'src/modules/a/own.ts': "export {a} from './private'\n",
    'src/modules/b/main.ts': 'export const b = 1\n',
    'src/modules/b/private.ts': 'export const b = 1\n',
  })

  it("fails an import of another module's private file", () => {
    for (const file of ['private', 'relative', 'dynamic'])
      expect(codesFor(diagnostics, `src/modules/a/${file}.ts`)).toEqual([
        'uz(module-boundaries)',
      ])
  })

  it("passes another module's main, and a module's own files", () => {
    expect(codesFor(diagnostics, 'src/modules/a/entry.ts')).toEqual([])
    expect(codesFor(diagnostics, 'src/modules/a/own.ts')).toEqual([])
  })
})
