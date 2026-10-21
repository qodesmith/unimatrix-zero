import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/tsx-under-ui', () => {
  const diagnostics = lintFixture(['uz/tsx-under-ui'], {
    'src/modules/a/Card.tsx': 'export const x = 1\n',
    'src/modules/a/ui/Card.tsx': 'export const x = 1\n',
    'src/modules/a/card.ts': 'export const x = 1\n',
  })

  it('fails a .tsx outside a ui/ folder', () => {
    expect(codesFor(diagnostics, 'src/modules/a/Card.tsx')).toEqual([
      'uz(tsx-under-ui)',
    ])
  })

  it('passes a .tsx under ui/, and a .ts anywhere', () => {
    expect(codesFor(diagnostics, 'src/modules/a/ui/Card.tsx')).toEqual([])
    expect(codesFor(diagnostics, 'src/modules/a/card.ts')).toEqual([])
  })
})
