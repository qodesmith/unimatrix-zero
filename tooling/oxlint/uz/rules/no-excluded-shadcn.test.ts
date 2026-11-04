import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/no-excluded-shadcn', () => {
  const diagnostics = lintFixture(['uz/no-excluded-shadcn'], {
    'src/shadcn/ui/toast.tsx': 'export const x = 1\n',
    'src/shadcn/ui/code-block.tsx': 'export const x = 1\n',
    'src/shadcn/ui/sonner.tsx': 'export const x = 1\n',
    'src/modules/a/ui/toast.tsx': 'export const x = 1\n',
    'src/shadcn/lib/toast.ts': 'export const x = 1\n',
  })

  it('fails each excluded component that shadcn add writes', () => {
    expect(codesFor(diagnostics, 'src/shadcn/ui/toast.tsx')).toEqual([
      'uz(no-excluded-shadcn)',
    ])
    expect(codesFor(diagnostics, 'src/shadcn/ui/code-block.tsx')).toEqual([
      'uz(no-excluded-shadcn)',
    ])
  })

  it('passes an installed component, and a file outside shadcn/ui that shares a name', () => {
    expect(codesFor(diagnostics, 'src/shadcn/ui/sonner.tsx')).toEqual([])
    expect(codesFor(diagnostics, 'src/modules/a/ui/toast.tsx')).toEqual([])
    expect(codesFor(diagnostics, 'src/shadcn/lib/toast.ts')).toEqual([])
  })
})
