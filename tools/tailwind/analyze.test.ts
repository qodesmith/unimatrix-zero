import type {TailwindClassAnalysis} from './analyze'

import {beforeAll, describe, expect, it} from 'vitest'

import path from 'node:path'

import {analyzeTailwindClasses, loadClassVerifier} from './analyze'

const fixtureRoot = path.join(import.meta.dirname, 'fixtures', 'basic')

describe('analyzeTailwindClasses', () => {
  let analysis: TailwindClassAnalysis

  beforeAll(async () => {
    analysis = await analyzeTailwindClasses({projectRoot: fixtureRoot})
  })

  it('scans the fixture sources, excluding .d.ts files', () => {
    // src/ holds three sources plus two .d.ts files (globals, cn).
    expect(analysis.projectRoot).toBe(fixtureRoot)
    expect(analysis.filesScanned).toBe(3)
    expect(analysis.uniqueTokens).toBe(11)
  })

  it('verifies the expected 1:1 mapping, sorted by old token', () => {
    expect(analysis.verified.map(({from, to}) => `${from} => ${to}`)).toEqual([
      '[display:flex] => flex',
      'gap-[0.5rem] => gap-2',
      'hover:w-[16px] => hover:w-4',
      'mt-[4px] => mt-1',
      'p-[8px] => p-2',
      'w-[16px] => w-4',
      'z-[10] => z-10',
    ])
  })

  it('reports every location of a token, skipping interpolated templates', () => {
    const pair = analysis.verified.find(p => p.from === 'w-[16px]')

    // card.tsx line 3 uses w-[16px] inside a `${}` template — not listed;
    // util.ts line 11 holds two occurrences, each reported.
    expect(pair?.locations).toEqual([
      {file: path.join('src', 'button.tsx'), line: 5},
      {file: path.join('src', 'card.tsx'), line: 4},
      {file: path.join('src', 'util.ts'), line: 11},
      {file: path.join('src', 'util.ts'), line: 11},
    ])
  })

  it('emits one edit per verified occurrence, ordered by file and offset', () => {
    expect(
      analysis.edits.map(e => `${e.file}: ${e.original} => ${e.replacement}`)
    ).toEqual([
      `${path.join('src', 'button.tsx')}: w-[16px] => w-4`,
      `${path.join('src', 'button.tsx')}: p-[8px] => p-2`,
      `${path.join('src', 'button.tsx')}: hover:w-[16px] => hover:w-4`,
      `${path.join('src', 'card.tsx')}: w-[16px] => w-4`,
      `${path.join('src', 'card.tsx')}: [display:flex] => flex`,
      `${path.join('src', 'util.ts')}: mt-[4px] => mt-1`,
      `${path.join('src', 'util.ts')}: gap-[0.5rem] => gap-2`,
      `${path.join('src', 'util.ts')}: z-[10] => z-10`,
      `${path.join('src', 'util.ts')}: w-[16px] => w-4`,
      `${path.join('src', 'util.ts')}: w-[16px] => w-4`,
    ])
  })

  it('emits edit offsets that map 1:1 onto the source text', async () => {
    await Promise.all(
      analysis.edits.map(async edit => {
        const text = await Bun.file(path.join(fixtureRoot, edit.file)).text()

        expect(text.slice(edit.start, edit.end)).toBe(edit.original)
      })
    )
  })

  it('never edits a near-miss token that merely contains a rewritable one', () => {
    // util.ts places w-[16px]x right next to two real w-[16px] tokens.
    expect(analysis.edits.some(e => e.original === 'w-[16px]x')).toBe(false)
  })

  it('does not pick up tokens outside className attrs and class-fn calls', () => {
    // util.ts declares `notExtracted = 'p-[8px] w-[32px]'` outside any span:
    // p-[8px]'s only location is button.tsx, and w-[32px] never shows up.
    const pair = analysis.verified.find(p => p.from === 'p-[8px]')

    expect(pair?.locations).toEqual([
      {file: path.join('src', 'button.tsx'), line: 5},
    ])
    expect(analysis.verified.some(p => p.from === 'w-[32px]')).toBe(false)
  })

  it('rejects suggestions whose CSS diverges under the runtime cascade', () => {
    // styles.css overrides --radius-sm in :root, so rounded-[4px] (0.25rem)
    // and rounded-sm (0.35rem at runtime) are not equivalent.
    expect(analysis.rejected).toEqual([
      {
        from: 'rounded-[4px]',
        to: 'rounded-sm',
        reason: expect.stringContaining('css mismatch'),
      },
    ])
    expect(analysis.rejected[0].reason).toContain('0.25rem')
    expect(analysis.rejected[0].reason).toContain('0.35rem')
  })

  it('leaves tokens without a canonical theme value untouched', () => {
    // No --leading-* in the fixture theme, so leading-[1.5] has no canonical
    // form: neither verified nor rejected.
    const mentioned = [...analysis.verified, ...analysis.rejected].some(
      p => p.from === 'leading-[1.5]'
    )
    expect(mentioned).toBe(false)
  })

  it('is pure — never writes to the scanned files', async () => {
    // A signature non-canonical token per source is still on disk.
    const stillPresent = [
      ['button.tsx', 'w-[16px]'],
      ['card.tsx', 'rounded-[4px] w-[16px]'],
      ['util.ts', 'mt-[4px]'],
    ]

    await Promise.all(
      stillPresent.map(async ([file, token]) => {
        const text = await Bun.file(path.join(fixtureRoot, 'src', file)).text()

        expect(text).toContain(token)
      })
    )
  })

  it('maps px values against the configured root font-size', async () => {
    // At rem: 8, 16px is 2rem — four 0.25rem spacing units becomes eight.
    const at8 = await analyzeTailwindClasses({
      projectRoot: fixtureRoot,
      rem: 8,
    })
    const pair = at8.verified.find(p => p.from === 'w-[16px]')

    expect(pair?.to).toBe('w-8')
  })

  it('throws when components.json has no tailwind.css path', async () => {
    await expect(
      analyzeTailwindClasses({
        projectRoot: path.join(import.meta.dirname, 'fixtures', 'no-css'),
      })
    ).rejects.toThrow('components.json has no tailwind.css path')
  })
})

describe('analyzeTailwindClasses (radius fixture)', () => {
  // The fixture mirrors this repo's setup: radius utilities derive from a
  // :root-overridden --radius, so the IDE plugin flags both rounded-[2px]
  // and rounded-[4px] — but only the first suggestion is safe to apply.
  const radiusRoot = path.join(import.meta.dirname, 'fixtures', 'radius')
  let analysis: TailwindClassAnalysis

  beforeAll(async () => {
    analysis = await analyzeTailwindClasses({projectRoot: radiusRoot})
  })

  it('verifies rounded-[2px] → rounded-xs (no runtime override)', () => {
    expect(analysis.verified).toEqual([
      {
        from: 'rounded-[2px]',
        to: 'rounded-xs',
        locations: [{file: path.join('src', 'box.tsx'), line: 3}],
      },
    ])
  })

  it('emits an edit for the verified pair only', async () => {
    const file = path.join('src', 'box.tsx')
    const box = await Bun.file(path.join(radiusRoot, file)).text()
    const start = box.indexOf('rounded-[2px]')

    expect(analysis.edits).toEqual([
      {
        file,
        start,
        end: start + 'rounded-[2px]'.length,
        original: 'rounded-[2px]',
        replacement: 'rounded-xs',
      },
    ])
  })

  it('rejects rounded-[4px] → rounded-lg (:root makes it 0.625rem)', () => {
    // The exact reason also pins comment handling: the fixture's stylesheet
    // comment mentions `--var: value` declarations in prose, which must not
    // leak into the normalizer's variable map.
    expect(analysis.rejected).toEqual([
      {
        from: 'rounded-[4px]',
        to: 'rounded-lg',
        reason:
          'css mismatch:\n' +
          '  OLD: { border-radius: 0.25rem; }\n' +
          '  NEW: { border-radius: 0.625rem; }',
      },
    ])
  })
})

describe('loadClassVerifier', () => {
  it('suggests canonical forms and returns null when there is none', async () => {
    const verifier = await loadClassVerifier({projectRoot: fixtureRoot})

    expect(verifier.suggest('w-[16px]')).toBe('w-4')
    expect(verifier.suggest('flex')).toBeNull()
    expect(verifier.suggest('not-a-class')).toBeNull()
  })

  it('checks old→new pairs for CSS equivalence', async () => {
    const verifier = await loadClassVerifier({projectRoot: fixtureRoot})

    expect(verifier.check('w-[16px]', 'w-4')).toEqual({
      equivalent: true,
      reason: '',
    })
    expect(verifier.check('rounded-[4px]', 'rounded-sm')).toEqual({
      equivalent: false,
      reason: expect.stringContaining('css mismatch'),
    })
    expect(verifier.check('w-[16px]', 'no-such-utility')).toEqual({
      equivalent: false,
      reason: 'new candidate compiles to null',
    })
    expect(verifier.check('not-a-class', 'w-4')).toEqual({
      equivalent: false,
      reason: 'old candidate compiles to null',
    })
  })
})
