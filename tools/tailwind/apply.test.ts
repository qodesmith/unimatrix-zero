import type {Edit} from './apply'

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

function tempDir(prefix = 'tw-apply-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))

  tempDirs.push(dir)

  return dir
}

/** Copies a fixture into a fresh temp dir cleaned up after the test. */
function copyFixture(name = 'basic'): string {
  const dir = tempDir()

  cpSync(path.join(fixturesDir, name), dir, {recursive: true})

  return dir
}

/** Builds an edit for the nth occurrence of `original` in `text`. */
function editAt(
  file: string,
  text: string,
  original: string,
  replacement: string,
  nth = 0
): Edit {
  let start = -1

  for (let i = 0; i <= nth; i++) start = text.indexOf(original, start + 1)

  if (start === -1) throw new Error(`token not found: ${original}`)

  return {file, start, end: start + original.length, original, replacement}
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

    // leading-[1.5] has no canonical form; w-[16px]x is not a whole token;
    // notExtracted is out of scope.
    expect(await Bun.file(path.join(root, 'src', 'util.ts')).text()).toBe(
      [
        'declare function cva(base: string, config: unknown): unknown',
        'declare function twMerge(...classes: string[]): string',
        '',
        "export const styles = cva('mt-1', {",
        "  variants: {size: {sm: 'gap-2'}},",
        '})',
        '',
        'export const merged = twMerge(',
        "  'leading-[1.5]',",
        "  'z-10',",
        "  'w-[16px]x w-4 w-4'",
        ')',
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
    expect(second.edits).toEqual([])
    expect(await applyCanonicalFixes(second)).toEqual([])
  })
})

describe('applyCanonicalFixes (unit)', () => {
  it('returns no files and writes nothing when there are no edits', async () => {
    const dir = tempDir()
    const text = '<div className="w-[16px]" />'
    await Bun.write(path.join(dir, 'a.tsx'), text)

    expect(await applyCanonicalFixes({projectRoot: dir, edits: []})).toEqual([])
    expect(await Bun.file(path.join(dir, 'a.tsx')).text()).toBe(text)
  })

  it('applies edits end-first so earlier offsets stay valid as text grows', async () => {
    const dir = tempDir()
    // The first replacement grows the text; the later edits must still land.
    const text = `cn('mt-[4px]'); cn('mt-[4px] w-[16px]')`
    await Bun.write(path.join(dir, 'a.tsx'), text)

    const edits = [
      editAt('a.tsx', text, 'mt-[4px]', 'mt-really-long-1'),
      editAt('a.tsx', text, 'mt-[4px]', 'mt-really-long-1', 1),
      editAt('a.tsx', text, 'w-[16px]', 'w-4'),
    ]

    expect(await applyCanonicalFixes({projectRoot: dir, edits})).toEqual([
      'a.tsx',
    ])
    expect(await Bun.file(path.join(dir, 'a.tsx')).text()).toBe(
      `cn('mt-really-long-1'); cn('mt-really-long-1 w-4')`
    )
  })

  it('throws on a stale edit and writes nothing at all', async () => {
    const dir = tempDir()
    const freshText = `cn('mt-[4px]')`
    const staleText = `cn('w-[16px]')`
    await Bun.write(path.join(dir, 'a.tsx'), freshText)
    await Bun.write(path.join(dir, 'b.tsx'), staleText)

    const edits = [
      editAt('a.tsx', freshText, 'mt-[4px]', 'mt-1'),
      // Offsets computed against text b.tsx no longer contains.
      editAt('b.tsx', `cn('gap-[8px]')`, 'gap-[8px]', 'gap-2'),
    ]

    await expect(
      applyCanonicalFixes({projectRoot: dir, edits})
    ).rejects.toThrow('the file changed after analysis')

    // The valid a.tsx edit was not applied either — zero writes on throw.
    expect(await Bun.file(path.join(dir, 'a.tsx')).text()).toBe(freshText)
    expect(await Bun.file(path.join(dir, 'b.tsx')).text()).toBe(staleText)
  })

  it('leaves files without edits untouched and unreported', async () => {
    const dir = tempDir()
    const changedText = `cn('w-[16px]')`
    const cleanText = `cn('flex')`
    await Bun.write(path.join(dir, 'a.tsx'), changedText)
    await Bun.write(path.join(dir, 'b.tsx'), cleanText)

    const edits = [editAt('a.tsx', changedText, 'w-[16px]', 'w-4')]

    expect(await applyCanonicalFixes({projectRoot: dir, edits})).toEqual([
      'a.tsx',
    ])
    expect(await Bun.file(path.join(dir, 'b.tsx')).text()).toBe(cleanText)
  })
})
