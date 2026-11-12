import {describe, expect, it} from 'vitest'

import {problemsOf} from './provider-dependencies.ts'

function entry(id: string, fields: Partial<Record<string, string>> = {}) {
  const defaults = {
    Id: `\`${id}\``,
    Kind: 'D',
    Provider: 'Claude',
    'Relies on': 'something Claude does.',
    'App side': 'something the app does.',
    'User would see': 'something break.',
    'Changed by': 'upgrade',
    Check: `\`[dep:${id}]\` in \`claude-driver\``,
  }

  const all = new Map([...Object.entries(defaults), ...Object.entries(fields)])

  const lines = [...all].flatMap(([name, value]) =>
    value === undefined ? [] : [`- **${name}:** ${value}`]
  )

  return [`### ${id} title`, '', ...lines, ''].join('\n')
}

function list(...entries: string[]) {
  return ['# Provider dependencies', '', '## Entries', '', ...entries].join(
    '\n'
  )
}

function test(...ids: string[]) {
  return {
    file: 'app/x.live.test.ts',
    source: ids.map(id => `it('[dep:${id}] holds', () => {})`).join('\n'),
  }
}

describe('the Provider dependencies lint', () => {
  it('passes an entry with a live check its test names, and one with a reason', () => {
    const doc = list(
      entry('checked'),
      entry('reasoned', {Check: 'none: needs a sign-in'})
    )

    expect(problemsOf(doc, [test('checked')])).toEqual([])
  })

  it('fails an entry with neither a live check nor a reason', () => {
    const doc = list(
      entry('blank', {Check: 'later'}),
      entry('reasonless', {Check: 'none: '})
    )

    expect(problemsOf(doc, [])).toEqual([
      'blank: Check names neither a live check nor "none: <reason>"',
      'reasonless: Check names neither a live check nor "none: <reason>"',
    ])
  })

  it('fails an entry without a field', () => {
    expect(problemsOf(list(entry('bare', {Check: undefined})), [])).toEqual([
      'bare title: no **Check:**',
      'bare: Check names neither a live check nor "none: <reason>"',
    ])
  })

  it('fails a check that names an id the list lacks', () => {
    expect(problemsOf(list(entry('kept')), [test('kept', 'gone')])).toEqual([
      "app/x.live.test.ts: [dep:gone] isn't in docs/provider-dependencies.md",
    ])
  })

  it('fails an entry whose live check no test names', () => {
    expect(problemsOf(list(entry('untested')), [])).toEqual([
      'untested: no test is named [dep:untested]',
    ])
  })

  it('fails an entry whose Check names another entry’s check', () => {
    const doc = list(
      entry('one'),
      entry('two', {Check: '`[dep:one]` in `claude-driver`'})
    )

    expect(problemsOf(doc, [test('one')])).toEqual([
      'two: Check names [dep:one], not [dep:two]',
    ])
  })

  it('fails an entry that gives a reason while a test checks it', () => {
    const doc = list(entry('both', {Check: 'none: too slow'}))

    expect(problemsOf(doc, [test('both')])).toEqual([
      'both: Check gives a reason, but app/x.live.test.ts has [dep:both]',
    ])
  })

  it('fails two entries with one id, and fields outside their values', () => {
    const doc = list(
      entry('twice'),
      entry('twice', {
        Kind: 'X',
        Provider: 'Gemini',
        'Changed by': 'drift',
        Id: '`twice`',
      })
    )

    expect(problemsOf(doc, [test('twice')])).toEqual([
      'twice title: **Kind:** can\'t be "X"',
      'twice title: **Provider:** can\'t be "Gemini"',
      'twice title: **Changed by:** can\'t be "drift"',
      'twice: two entries share this id',
    ])
  })
})
