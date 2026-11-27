import {describe, expect, it} from 'vitest'

import {entriesToReview, reviewsOf} from './provider-review-scope.ts'

function entry(id: string, reliesOn: string) {
  return `### The title of ${id}

- **Id:** \`${id}\`
- **Relies on:** ${reliesOn}
`
}

function list(above: string, ...entries: string[]) {
  return `${above}\n\n## Entries\n\n${entries.join('\n')}`
}

const BASE = list(
  'What a field means.',
  entry('first', 'claude writes a note'),
  entry('second', 'codex writes a file')
)

function reviewedIds(pinMoved: boolean, headList: string) {
  return entriesToReview({pinMoved, baseList: BASE, headList}).map(({id}) => id)
}

describe('the entries a provider-checks run reviews', () => {
  it('are all of them when a pin moved, though the list is as on the base', () => {
    expect(reviewedIds(true, BASE)).toEqual(['first', 'second'])
  })

  it('are the one the PR adds and the one whose field it changes, when no pin moved', () => {
    const head = list(
      'What a field means.',
      entry('first', 'claude writes a note'),
      entry('second', 'codex writes two files'),
      entry('third', 'claude exits')
    )

    expect(reviewedIds(false, head)).toEqual(['second', 'third'])
  })

  it('are none when no pin moved and the PR changes only the order, a title or the text above the entries', () => {
    const head = list(
      'What a field means, said another way.',
      entry('second', 'codex writes a file'),
      entry('first', 'claude writes a note').replace('The title', 'A title')
    )

    expect(reviewedIds(false, head)).toEqual([])
  })
})

describe('the reviews of a run', () => {
  it('give each entry its review, or mark it not needed, in the list’s order', () => {
    const entries = ['first', 'second', 'third'].map(id => ({
      id,
      title: id,
      fields: {},
    }))

    const reviews = reviewsOf(entries, [
      {id: 'second', verdict: 'stale', reason: 'gone'},
    ])

    expect(reviews.map(({id, verdict}) => [id, verdict])).toEqual([
      ['first', 'not needed'],
      ['second', 'stale'],
      ['third', 'not needed'],
    ])
  })
})
