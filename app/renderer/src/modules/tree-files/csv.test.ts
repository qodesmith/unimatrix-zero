import {expect, it} from 'vitest'

import {parseDelimited} from './csv'

it.each([
  [
    'plain fields',
    'a,b\nc,d',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ],
  ['a comma inside quotes', '"Lisbon, PT",3', [['Lisbon, PT', '3']]],
  ['doubled quotes as one', '"say ""hi""",x', [['say "hi"', 'x']]],
  [
    'a newline inside quotes',
    '"two\nlines",x\ny,z',
    [
      ['two\nlines', 'x'],
      ['y', 'z'],
    ],
  ],
  [
    'CRLF between records',
    'a,b\r\nc,d\r\n',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ],
  [
    'empty fields',
    'a,,b\n,',
    [
      ['a', '', 'b'],
      ['', ''],
    ],
  ],
  ['no row for the last newline', 'a\n', [['a']]],
  ['an empty line as one empty field', 'a\n\nb', [['a'], [''], ['b']]],
  [
    'the rest of a quote never closed',
    'a,"open\nstill',
    [['a', 'open\nstill']],
  ],
])('reads %s', (_, text, rows) => {
  expect(parseDelimited(text, ',')).toEqual(rows)
})

it('splits a TSV by tabs and leaves its commas in the fields', () => {
  expect(parseDelimited('a,1\tb\n"c\td"\te', '\t')).toEqual([
    ['a,1', 'b'],
    ['c\td', 'e'],
  ])
})

it('reads nothing from an empty file', () => {
  expect(parseDelimited('', ',')).toEqual([])
})
