import {expect, it} from 'vitest'

import {codesFor, lintFixture} from '../../lint-fixture'

const RULE = 'uz(no-fixture-assertion)'

/** Each case is one test file, so a report names the case that made it. */
const cases = {
  'built-object': `
    it('waits', () => {
      const paged = {...query({isPending: false}), hasNextPage: true}
      renderHook(() => useWholeList(query()))
      expect(paged.hasNextPage).toBe(true)
    })`,
  'file-level-fixture': `
    const summary = {id: 't-1'}
    it('answers', () => {
      expect(summary.id).toBe('t-1')
    })`,
  'only-used-as-expected': `
    it('answers', () => {
      const summary = {id: 't-1'}
      expect(summary.id).toEqual(summary.id)
      expect(answer(input)).toBe(summary.id)
    })`,
  'mock-on-fixture': `
    it('waits', () => {
      const paged = {fetchNextPage: vi.fn()}
      renderHook(() => useWholeList(paged))
      expect(paged.fetchNextPage).not.toHaveBeenCalled()
    })`,
  'recording-array': `
    it('sends nothing', async () => {
      const seen = []
      await run(seen)
      expect(seen).toHaveLength(0)
    })`,
  'written-by-unit': `
    it('forwards the ref', () => {
      const ref = {current: null}
      const state = {count: 0}
      render(<Field ref={ref} />)
      increment(state)
      expect(ref.current).not.toBeNull()
      expect(state.count).toBe(1)
    })`,
  'compared-to-unit': `
    it('summarizes', () => {
      const expected = {id: 't-1'}
      const result = summarize(input)
      expect(expected).toEqual(summarize(input))
      expect(expected.id).toBe(result.id)
    })`,
  'shadowed-by-result': `
    const result = {id: 't-1'}
    it('answers', () => {
      const result = summarize(input)
      expect(result.id).toBe('t-1')
    })`,
}

const diagnostics = lintFixture(
  ['uz/no-fixture-assertion'],
  Object.fromEntries(
    Object.entries(cases).map(([name, code]) => [`${name}.test.tsx`, code])
  )
)

it.each(['built-object', 'file-level-fixture', 'only-used-as-expected'])(
  'fails %s: the assertion reads back a value the test built',
  name => {
    expect(codesFor(diagnostics, `${name}.test.tsx`)).toEqual([RULE])
  }
)

it.each([
  'mock-on-fixture',
  'recording-array',
  'written-by-unit',
  'compared-to-unit',
  'shadowed-by-result',
])('passes %s: the unit wrote or produced the value', name => {
  expect(codesFor(diagnostics, `${name}.test.tsx`)).toEqual([])
})
