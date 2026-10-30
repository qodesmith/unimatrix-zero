import {describe, expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

describe('uz/shadcn-base-ui', () => {
  const diagnostics = lintFixture(['uz/shadcn-base-ui'], {
    'src/modules/a/ui/Button.tsx':
      'export const x = <button type="button" />\n',
    'src/modules/a/ui/Input.tsx': 'export const x = <input />\n',
    'src/modules/a/ui/Select.tsx': 'export const x = <select />\n',
    'src/modules/a/ui/Textarea.tsx': 'export const x = <textarea />\n',
    'src/modules/a/ui/Shadcn.tsx':
      "import {Button} from '#modules/shadcn/main'\n\nexport const x = <Button />\n",
    'src/modules/shadcn/ui/button.tsx': 'export const x = <button />\n',
    'src/modules/a/radix.ts': "export {Dialog} from 'radix-ui'\n",
    'src/modules/a/scoped.ts': "import '@radix-ui/react-dialog'\n",
    'src/modules/shadcn/ui/dialog.tsx':
      "export {Dialog} from '@radix-ui/react-dialog'\n",
  })

  it('fails a plain <button>, <input>, <select> or <textarea> outside shadcn/ui', () => {
    for (const file of ['Button', 'Input', 'Select', 'Textarea'])
      expect(codesFor(diagnostics, `src/modules/a/ui/${file}.tsx`)).toEqual([
        'uz(shadcn-base-ui)',
      ])
  })

  it('passes a shadcn component, and the plain element inside shadcn/ui', () => {
    expect(codesFor(diagnostics, 'src/modules/a/ui/Shadcn.tsx')).toEqual([])
    expect(codesFor(diagnostics, 'src/modules/shadcn/ui/button.tsx')).toEqual(
      []
    )
  })

  it('fails a Radix import anywhere, shadcn/ui included', () => {
    for (const file of [
      'src/modules/a/radix.ts',
      'src/modules/a/scoped.ts',
      'src/modules/shadcn/ui/dialog.tsx',
    ])
      expect(codesFor(diagnostics, file)).toEqual(['uz(shadcn-base-ui)'])
  })
})
