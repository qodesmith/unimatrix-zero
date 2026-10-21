import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/no-hardcoded-colors', () => {
  const diagnostics = lintFixture(['uz/no-hardcoded-colors'], {
    'palette.ts': "export const c = 'p-2 bg-zinc-900'\n",
    'hex.ts': "export const c = '#fff'\n",
    'template.ts':
      'export const c = (on: boolean) => `${on} text-red-500/50`\n',
    'token.ts': "export const c = 'bg-primary text-muted-foreground'\n",
  })

  it('fails a palette class or a color literal', () => {
    for (const file of ['palette.ts', 'hex.ts', 'template.ts'])
      expect(codesFor(diagnostics, file)).toEqual(['uz(no-hardcoded-colors)'])
  })

  it('passes a Theme token class', () => {
    expect(codesFor(diagnostics, 'token.ts')).toEqual([])
  })
})
