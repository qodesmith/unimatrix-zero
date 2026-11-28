import {describe, expect, it} from 'vitest'

import {sameCode} from './same-code.ts'

const BEFORE = `// Sends the prompt.
import {send} from './send.ts'

/** The reply to wait for. */
export async function reply(prompt: string): Promise<string> {
  // A note on the wait.
  return send(prompt, {tries: 3n, match: /done/u}) /* trailing */
}
`

describe('two versions of a file hold the same code', () => {
  it('when only comments, blank lines, line breaks and types differ, in TypeScript and in JSX', () => {
    const after = `import {send} from './send.ts'

import type {Prompt} from './prompt.ts'

interface Sent {
  text: string
}

export async function reply(
  prompt: Prompt | null
): Promise<Sent['text']> {
  // A new note.
  return send(prompt, {tries: 3n, match: /done/u})
}
`

    expect(sameCode('a.live.test.ts', BEFORE, after)).toBe(true)
    expect(
      sameCode(
        'a.tsx',
        'export const a = <p title="t">{/* old */}hi</p>',
        '// new\nexport const a = (\n  <p title="t">{/* newer */}hi</p>\n)'
      )
    ).toBe(true)
  })

  it('but not when a statement, a string, a number or what a file imports differs', () => {
    for (const [from, to] of [
      ['return send(', 'return void send('],
      ["'./send.ts'", "'./sent.ts'"],
      ['3n', '4n'],
      ['/done/u', '/done/iu'],
      ['import {send}', 'import type {send}'],
      ['prompt: string', 'prompt = 1'],
    ] as const) {
      expect({
        from,
        same: sameCode('a.ts', BEFORE, BEFORE.replace(from, to)),
      }).toEqual({from, same: false})
    }
  })

  it('but not when an import a file uses only as a type stops loading its module', () => {
    expect(
      sameCode(
        'a.ts',
        "import {Prompt} from './prompt.ts'\nexport type A = Prompt",
        "import type {Prompt} from './prompt.ts'\nexport type A = Prompt"
      )
    ).toBe(false)
  })

  it('but not when a directive comment is added, changed or moved past another, while an untouched one allows it', () => {
    const directive = `// @vitest-environment node\n/* @vite-ignore */\n${BEFORE}`

    expect(sameCode('a.ts', BEFORE, directive)).toBe(false)
    expect(
      sameCode('a.ts', directive, directive.replace('node', 'jsdom'))
    ).toBe(false)
    expect(
      sameCode(
        'a.ts',
        directive,
        `/* @vite-ignore */\n// @vitest-environment node\n${BEFORE}`
      )
    ).toBe(false)
    expect(
      sameCode('a.ts', directive, directive.replace('// Sends the prompt.', ''))
    ).toBe(true)
    expect(sameCode('a.ts', 'f()', '/* __PURE__ */ f()')).toBe(false)
  })

  it('but never for a file that isn’t code, or for code that doesn’t parse', () => {
    expect(sameCode('recordings/a.ndjson', '[1]', '[1] // hand-edited')).toBe(
      false
    )
    expect(sameCode('a.ts', 'const = 1', 'const = 1 // why')).toBe(false)
  })
})
