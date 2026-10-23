import type {Prompt, Reply} from '@uz/contract/turns'

import {describe, expect, it} from 'vitest'

import {layoutTree} from './layout'
import {indexTurns} from './tree'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'

let clock = 0

function at(step: number) {
  return new Date(Date.UTC(2026, 9, 19, 12, 0, step)).toISOString()
}

function prompt(id: string, parentReplyId: string | null): Prompt {
  return {id, treeId, parentReplyId, text: id, createdAt: at(++clock)}
}

function reply(id: string, promptId: string): Reply {
  return {
    id,
    treeId,
    promptId,
    provider: 'claude',
    model: 'fake',
    status: 'complete',
    content: [{type: 'text', text: id}],
    contextSize: null,
    contextWindow: null,
    createdAt: at(++clock),
  }
}

/**
 * Two Forks: the root Reply has two Branches, and the first Branch's Reply
 * has three.
 *
 * ```text
 * P1 - R1 - P2 - R2 - P4 - R4
 *         |         - P5 - R5
 *         |         - P6 - R6
 *         - P3 - R3
 * ```
 */
function forkedTree() {
  clock = 0

  const prompts = [
    prompt('P1', null),
    prompt('P2', 'R1'),
    prompt('P3', 'R1'),
    prompt('P4', 'R2'),
    prompt('P5', 'R2'),
    prompt('P6', 'R2'),
  ]

  const replies = [
    reply('R1', 'P1'),
    reply('R2', 'P2'),
    reply('R3', 'P3'),
    reply('R4', 'P4'),
    reply('R5', 'P5'),
    reply('R6', 'P6'),
  ]

  return indexTurns({prompts, replies})
}

const width = 440

function sized(heights: Record<string, number>) {
  return (id: string) => ({width, height: heights[id] ?? 80})
}

/** Where the layout put a node, by id. */
function positions(layout: ReturnType<typeof layoutTree>) {
  const byId = new Map(layout.nodes.map(node => [node.id, node.position]))

  return (id: string) => {
    const position = byId.get(id)

    if (!position) throw new Error(`No node ${id} in the layout`)

    return position
  }
}

describe('vertical', () => {
  const layout = layoutTree(forkedTree(), 'vertical', sized({R1: 300}))
  const pos = positions(layout)

  it('draws every Prompt and Reply as its own box', () => {
    expect(layout.nodes.map(node => node.kind).toSorted()).toEqual([
      ...Array.from({length: 6}, () => 'prompt'),
      ...Array.from({length: 6}, () => 'reply'),
    ])
  })

  it('connects each Prompt to its Reply and each Branch to the Reply it answers', () => {
    expect(layout.edges.map(edge => `${edge.source}>${edge.target}`)).toEqual(
      expect.arrayContaining([
        'P1>R1',
        'R1>P2',
        'R1>P3',
        'R2>P4',
        'R2>P5',
        'R2>P6',
        'P6>R6',
      ])
    )
    expect(layout.edges).toHaveLength(11)
  })

  it('reads top-down: a Turn sits below the one it follows, clear of its height', () => {
    expect(pos('R1').y).toBeGreaterThan(pos('P1').y)
    expect(pos('P2').y).toBeGreaterThanOrEqual(pos('R1').y + 300)
    expect(pos('P2').y).toBe(pos('P3').y)
  })

  it('reads Branches oldest-first, left to right, without overlapping', () => {
    expect(pos('P2').x).toBeLessThan(pos('P3').x)
    expect(pos('P4').x).toBeLessThan(pos('P5').x)
    expect(pos('P5').x).toBeLessThan(pos('P6').x)
    expect(pos('P5').x - pos('P4').x).toBeGreaterThanOrEqual(width)
    expect(pos('P3').x - pos('R2').x).toBeGreaterThanOrEqual(width)
  })

  it('centers a Fork over its Branches', () => {
    const first = pos('P4').x
    const last = pos('P6').x + width
    expect(pos('R2').x + width / 2).toBeCloseTo((first + last) / 2)
  })
})

describe('horizontal', () => {
  const layout = layoutTree(
    forkedTree(),
    'horizontal',
    sized({P2: 320, P3: 100, P1: 200})
  )

  const pos = positions(layout)

  it('draws one card per Exchange, holding the Prompt and its Reply', () => {
    expect(layout.nodes).toHaveLength(6)
    expect(
      layout.nodes.map(node =>
        node.kind === 'exchange' ? `${node.prompt.id}+${node.reply?.id}` : node
      )
    ).toEqual(expect.arrayContaining(['P1+R1', 'P2+R2', 'P3+R3', 'P6+R6']))
  })

  it('connects each Exchange to the one its Prompt answers', () => {
    expect(
      layout.edges.map(edge => `${edge.source}>${edge.target}`).toSorted()
    ).toEqual(['P1>P2', 'P1>P3', 'P2>P4', 'P2>P5', 'P2>P6'])
  })

  it('reads left to right, Branches oldest-first from the top, clear of each height', () => {
    expect(pos('P2').x).toBeGreaterThanOrEqual(pos('P1').x + width)
    expect(pos('P2').x).toBe(pos('P3').x)
    expect(pos('P2').y).toBeLessThan(pos('P3').y)
    expect(pos('P3').y).toBeGreaterThanOrEqual(pos('P2').y + 320)
    expect(pos('P4').y).toBeLessThan(pos('P5').y)
    expect(pos('P5').y).toBeLessThan(pos('P6').y)
  })
})

it('lays out from the structure alone: the same Tree always lands in the same places', () => {
  const first = layoutTree(forkedTree(), 'vertical', sized({}))
  const second = layoutTree(forkedTree(), 'vertical', sized({}))

  expect(second.nodes).toEqual(first.nodes)
})

/** Two Branches of the root Reply, with the second one started at `second`. */
function twoBranches(second: string) {
  clock = 0
  const root = prompt('P1', null)
  const first = prompt('Pa', 'R1')
  const other = {...prompt('Pb', 'R1'), createdAt: second}

  return indexTurns({
    prompts: [root, first, other],
    replies: [reply('R1', 'P1'), reply('Ra', 'Pa'), reply('Rb', 'Pb')],
  })
}

it('orders Branches by when they were started, not by their ids', () => {
  const started = positions(
    layoutTree(twoBranches(at(0)), 'vertical', sized({}))
  )

  expect(started('Pb').x).toBeLessThan(started('Pa').x)

  const tied = positions(layoutTree(twoBranches(at(2)), 'vertical', sized({})))
  expect(tied('Pa').x).toBeLessThan(tied('Pb').x)
})
