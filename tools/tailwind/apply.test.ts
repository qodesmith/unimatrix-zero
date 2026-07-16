import type {TailwindClassAnalysis} from './analyze'
import type {Literal} from './extract'

import {afterEach, describe, expect, it} from 'vitest'

import {cpSync, mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {analyzeTailwindClasses} from './analyze'
import {applyCanonicalFixes} from './apply'

const fixturesDir = path.join(import.meta.dirname, 'fixtures')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {recursive: true, force: true})
  }
})

/** Copies a fixture into a fresh temp dir cleaned up after the test. */
function copyFixture(name = 'basic'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-apply-'))

  tempDirs.push(dir)
  cpSync(path.join(fixturesDir, name), dir, {recursive: true})

  return dir
}

/** A minimal analysis for unit tests that bypass the Tailwind engine. */
function makeAnalysis(
  projectRoot: string,
  fileTexts: Map<string, string>,
  literals: Literal[],
  verified: [from: string, to: string][]
): TailwindClassAnalysis {
  return {
    projectRoot,
    filesScanned: fileTexts.size,
    uniqueTokens: 0,
    verified: verified.map(([from, to]) => ({from, to, locations: []})),
    rejected: [],
    literals,
    fileTexts,
  }
}

function literalAt(file: string, text: string, inner: string): Literal {
  const start = text.indexOf(inner)

  if (start === -1) throw new Error(`literal not found: ${inner}`)

  return {file, start, end: start + inner.length, text: inner}
}

describe('applyCanonicalFixes (analyze integration)', () => {
  it('writes only verified replacements and reports changed files', async () => {
    const root = copyFixture()
    const analysis = await analyzeTailwindClasses({projectRoot: root})
    const changed = await applyCanonicalFixes(analysis)

    expect(changed).toEqual([
      path.join('src', 'button.tsx'),
      path.join('src', 'card.tsx'),
      path.join('src', 'util.ts'),
    ])

    expect(await Bun.file(path.join(root, 'src', 'button.tsx')).text()).toBe(
      [
        "import {cn} from './cn'",
        '',
        'export function Button({active}: {active: boolean}) {',
        '  return (',
        "    <button className={cn('flex w-4', active && 'p-2')}>",
        '      <span className="hover:w-4">go</span>',
        '    </button>',
        '  )',
        '}',
        '',
      ].join('\n')
    )

    // rounded-[4px] was rejected (stays) and the `${}` template is untouched.
    expect(await Bun.file(path.join(root, 'src', 'card.tsx')).text()).toBe(
      [
        'export function Card({extra}: {extra: string}) {',
        '  return (',
        // oxlint-disable-next-line no-template-curly-in-string -- asserting the template survived
        '    <div className={`w-[16px] ${extra}`}>',
        '      <div className="rounded-[4px] w-4">x</div>',
        "      <p className={'flex'}>y</p>",
        '    </div>',
        '  )',
        '}',
        '',
      ].join('\n')
    )

    // leading-[1.5] has no canonical form; notExtracted is out of scope.
    expect(await Bun.file(path.join(root, 'src', 'util.ts')).text()).toBe(
      [
        'declare function cva(base: string, config: unknown): unknown',
        'declare function twMerge(...classes: string[]): string',
        '',
        "export const styles = cva('mt-1', {",
        "  variants: {size: {sm: 'gap-2'}},",
        '})',
        '',
        "export const merged = twMerge('leading-[1.5]', 'z-10')",
        '',
        '// Outside any className/cn span — never extracted:',
        "export const notExtracted = 'p-[8px] w-[32px]'",
        '',
      ].join('\n')
    )
  })

  it('rewrites a safe radius suggestion, keeps its unsafe sibling', async () => {
    // Same design system suggests fixes for both rounded-[2px] and
    // rounded-[4px]; only the first survives CSS-equivalence verification
    // because :root overrides --radius at runtime.
    const root = copyFixture('radius')

    await applyCanonicalFixes(await analyzeTailwindClasses({projectRoot: root}))
    const box = await Bun.file(path.join(root, 'src', 'box.tsx')).text()

    expect(box).toContain('className="rounded-xs"')
    expect(box).toContain('className="rounded-[4px]"')
    expect(box).not.toContain('rounded-lg')
  })

  it('is idempotent — a second pass finds nothing to change', async () => {
    const root = copyFixture()

    await applyCanonicalFixes(await analyzeTailwindClasses({projectRoot: root}))
    const second = await analyzeTailwindClasses({projectRoot: root})

    expect(second.verified).toEqual([])
    expect(await applyCanonicalFixes(second)).toEqual([])
  })
})

describe('applyCanonicalFixes (unit)', () => {
  it('returns no files and writes nothing when the mapping is empty', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-apply-'))
    tempDirs.push(dir)

    const file = path.join(dir, 'a.tsx')
    const text = '<div className="w-[16px]" />'
    await Bun.write(file, text)

    const analysis = makeAnalysis(
      dir,
      new Map([[file, text]]),
      [literalAt(file, text, 'w-[16px]')],
      []
    )

    expect(await applyCanonicalFixes(analysis)).toEqual([])
    expect(await Bun.file(file).text()).toBe(text)
  })

  it('replaces whole tokens only and preserves whitespace exactly', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-apply-'))
    tempDirs.push(dir)

    const file = path.join(dir, 'a.tsx')
    const inner = 'w-[16px]   flex\n  w-[16px]x w-[16px]'
    const text = `<div className={\`${inner}\`} />`
    await Bun.write(file, text)

    const analysis = makeAnalysis(
      dir,
      new Map([[file, text]]),
      [literalAt(file, text, inner)],
      [['w-[16px]', 'w-4']]
    )

    expect(await applyCanonicalFixes(analysis)).toEqual(['a.tsx'])
    expect(await Bun.file(file).text()).toBe(
      '<div className={`w-4   flex\n  w-[16px]x w-4`} />'
    )
  })

  it('keeps offsets valid across multiple literals in one file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-apply-'))
    tempDirs.push(dir)

    const file = path.join(dir, 'a.tsx')
    // The first replacement grows the text; the second must still land.
    const text = `cn('mt-[4px]'); cn('mt-[4px] w-[16px]')`
    await Bun.write(file, text)

    const analysis = makeAnalysis(
      dir,
      new Map([[file, text]]),
      [
        {file, start: 4, end: 12, text: 'mt-[4px]'},
        {file, start: 20, end: 37, text: 'mt-[4px] w-[16px]'},
      ],
      [
        ['mt-[4px]', 'mt-really-long-1'],
        ['w-[16px]', 'w-4'],
      ]
    )

    expect(await applyCanonicalFixes(analysis)).toEqual(['a.tsx'])
    expect(await Bun.file(file).text()).toBe(
      `cn('mt-really-long-1'); cn('mt-really-long-1 w-4')`
    )
  })

  it('leaves files without matching tokens untouched', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-apply-'))
    tempDirs.push(dir)

    const changedFile = path.join(dir, 'a.tsx')
    const cleanFile = path.join(dir, 'b.tsx')
    const changedText = `cn('w-[16px]')`
    const cleanText = `cn('flex')`
    await Bun.write(changedFile, changedText)
    await Bun.write(cleanFile, cleanText)

    const analysis = makeAnalysis(
      dir,
      new Map([
        [changedFile, changedText],
        [cleanFile, cleanText],
      ]),
      [
        literalAt(changedFile, changedText, 'w-[16px]'),
        literalAt(cleanFile, cleanText, 'flex'),
      ],
      [['w-[16px]', 'w-4']]
    )

    expect(await applyCanonicalFixes(analysis)).toEqual(['a.tsx'])
    expect(await Bun.file(cleanFile).text()).toBe(cleanText)
  })
})
