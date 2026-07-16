import {afterAll, describe, expect, it} from 'vitest'

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {extractLiterals, walk} from './extract'

/** Extracts from an inline source and returns just the literal texts. */
const texts = (source: string): string[] =>
  extractLiterals('test.tsx', source).map(lit => lit.text)

describe('extractLiterals', () => {
  it('captures double- and single-quoted className attributes', () => {
    expect(texts('<div className="flex w-4" />')).toEqual(['flex w-4'])
    expect(texts("<div className='flex w-4' />")).toEqual(['flex w-4'])
  })

  it('captures every string inside a className={...} expression', () => {
    const source = `<div className={active ? 'p-2' : 'p-4'} />`
    expect(texts(source)).toEqual(['p-2', 'p-4'])
  })

  it('captures strings inside each class-fn call', () => {
    for (const fn of ['cn', 'cva', 'clsx', 'tv', 'twMerge']) {
      expect(texts(`const c = ${fn}('mt-1', cond && 'gap-2')`)).toEqual([
        'mt-1',
        'gap-2',
      ])
    }
  })

  it('captures strings in nested calls and objects within a span', () => {
    const source = `cva('base', {variants: {size: {sm: helper('inner')}}})`
    expect(texts(source)).toEqual(['base', 'inner'])
  })

  it('does not match identifiers that merely end in a class-fn name', () => {
    expect(texts(`scn('w-4'); fancyTv('h-4')`)).toEqual([])
  })

  it('ignores strings outside className attrs and class-fn calls', () => {
    expect(texts(`const label = 'w-4 flex'`)).toEqual([])
  })

  it('captures template literals without interpolation', () => {
    expect(texts('<div className={`flex\n  w-4`} />')).toEqual(['flex\n  w-4'])
  })

  it('skips templates with interpolation wholesale', () => {
    // oxlint-disable-next-line no-template-curly-in-string -- literal ${} is the case under test
    const source = '<div className={`w-4 ${cond ? "p-2" : "p-4"}`} />'
    expect(texts(source)).toEqual([])
  })

  it('skips strings containing escapes', () => {
    expect(texts(`cn('it\\'s')`)).toEqual([])
  })

  it('skips empty and whitespace-only strings', () => {
    expect(texts(`cn('', '  ', 'w-4')`)).toEqual(['w-4'])
  })

  it('skips line and block comments inside spans', () => {
    const source = [
      'cn(',
      "  // 'line-commented'",
      "  'real',",
      "  /* 'block-commented' */",
      ')',
    ].join('\n')
    expect(texts(source)).toEqual(['real'])
  })

  it('does not collect twice when className wraps a class-fn call', () => {
    expect(texts(`<div className={cn('w-4')} />`)).toEqual(['w-4'])
  })

  it('keeps balance through parens inside string arguments', () => {
    expect(texts(`cn('a)b', 'c'); other('outside')`)).toEqual(['a)b', 'c'])
  })

  it('reports offsets that map 1:1 onto the source text', () => {
    const source = [
      `<div className={cn('flex w-4', active && 'p-2')}>`,
      `  <span className="mt-1">x</span>`,
      '</div>',
    ].join('\n')

    const literals = extractLiterals('test.tsx', source)

    expect(literals).toHaveLength(3)
    for (const lit of literals) {
      expect(source.slice(lit.start, lit.end)).toBe(lit.text)
    }
  })
})

describe('walk', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tw-walk-'))

  afterAll(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  it('returns sorted .ts/.tsx files and skips .d.ts and other types', () => {
    mkdirSync(path.join(dir, 'nested'))
    writeFileSync(path.join(dir, 'b.ts'), '')
    writeFileSync(path.join(dir, 'a.tsx'), '')
    writeFileSync(path.join(dir, 'nested', 'c.tsx'), '')
    writeFileSync(path.join(dir, 'types.d.ts'), '')
    writeFileSync(path.join(dir, 'styles.css'), '')

    expect(walk(dir)).toEqual([
      path.join(dir, 'a.tsx'),
      path.join(dir, 'b.ts'),
      path.join(dir, 'nested', 'c.tsx'),
    ])
  })
})
