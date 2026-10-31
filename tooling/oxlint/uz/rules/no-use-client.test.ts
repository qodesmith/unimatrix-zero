import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/no-use-client', () => {
  const diagnostics = lintFixture(['uz/no-use-client'], {
    'src/client.tsx': "'use client'\n\nexport const x = 1\n",
    'src/server.ts': '"use server"\n\nexport const x = 1\n',
    'src/inner.ts': "export function act() {\n  'use server'\n  return 1\n}\n",
    'src/strict.ts': "'use strict'\n\nexport const x = 1\n",
    'src/string.ts': "export const x = 'use client'\n",
  })

  it("fails a 'use client' or 'use server' directive, at the top or in a function", () => {
    for (const file of ['client.tsx', 'server.ts', 'inner.ts'])
      expect(codesFor(diagnostics, `src/${file}`)).toEqual([
        'uz(no-use-client)',
      ])
  })

  it('passes other directives, and the same words as a plain string', () => {
    expect(codesFor(diagnostics, 'src/strict.ts')).toEqual([])
    expect(codesFor(diagnostics, 'src/string.ts')).toEqual([])
  })
})
