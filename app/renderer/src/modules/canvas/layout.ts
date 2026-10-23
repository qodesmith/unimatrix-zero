import type {TreeIndex} from './tree'
import type {CanvasOrientation} from '@uz/contract/settings'
import type {Prompt, Reply} from '@uz/contract/turns'

import {branchesOf} from './tree'

export interface Size {
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

/** Every Turn is drawn this wide, in both orientations. */
export const TURN_WIDTH = 440

/** The box React Flow draws before it has measured a node. */
const DEFAULT_SIZE: Size = {width: TURN_WIDTH, height: 80}

interface PromptTurn {
  id: string
  kind: 'prompt'
  prompt: Prompt
}

interface ReplyTurn {
  id: string
  kind: 'reply'
  reply: Reply
}

/** One card per Exchange, keyed by its Prompt. */
interface ExchangeTurns {
  id: string
  kind: 'exchange'
  prompt: Prompt
  reply: Reply | null
}

type Unplaced = PromptTurn | ReplyTurn | ExchangeTurns

export type LayoutNode = Unplaced & {position: Point}

interface LayoutEdge {
  id: string
  source: string
  target: string
}

export interface Layout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

interface Gap {
  /** Between a Turn and the one that follows it, along the reading direction. */
  rank: number
  /** Between Branches, across it. */
  branch: number
}

const GAPS: Record<CanvasOrientation, Gap> = {
  vertical: {rank: 40, branch: 36},
  horizontal: {rank: 60, branch: 28},
}

interface Graph {
  nodes: Unplaced[]
  edges: LayoutEdge[]
  /** Each node's children in reading order. */
  children: Map<string, string[]>
  roots: string[]
}

function edge(source: string, target: string): LayoutEdge {
  return {id: `${source}-${target}`, source, target}
}

/** Vertical: every Turn its own box, a Reply under its Prompt. */
function turnGraph(index: TreeIndex): Graph {
  const nodes: Unplaced[] = []
  const edges: LayoutEdge[] = []
  const children = new Map<string, string[]>()
  const roots: string[] = []

  function visit(prompt: Prompt) {
    nodes.push({id: prompt.id, kind: 'prompt', prompt})
    const reply = index.replyByPrompt.get(prompt.id)

    if (!reply) {
      children.set(prompt.id, [])

      return
    }

    nodes.push({id: reply.id, kind: 'reply', reply})
    edges.push(edge(prompt.id, reply.id))
    children.set(prompt.id, [reply.id])
    const branches = branchesOf(index, reply.id)
    children.set(
      reply.id,
      branches.map(branch => branch.id)
    )

    for (const branch of branches) {
      edges.push(edge(reply.id, branch.id))
      visit(branch)
    }
  }

  for (const root of branchesOf(index, null)) {
    roots.push(root.id)
    visit(root)
  }

  return {nodes, edges, children, roots}
}

/** Horizontal: one card per Exchange, Branches fanning out to the right. */
function exchangeGraph(index: TreeIndex): Graph {
  const nodes: Unplaced[] = []
  const edges: LayoutEdge[] = []
  const children = new Map<string, string[]>()
  const roots: string[] = []

  function visit(prompt: Prompt) {
    const reply = index.replyByPrompt.get(prompt.id) ?? null
    nodes.push({id: prompt.id, kind: 'exchange', prompt, reply})
    const branches = reply ? branchesOf(index, reply.id) : []
    children.set(
      prompt.id,
      branches.map(branch => branch.id)
    )

    for (const branch of branches) {
      edges.push(edge(prompt.id, branch.id))
      visit(branch)
    }
  }

  for (const root of branchesOf(index, null)) {
    roots.push(root.id)
    visit(root)
  }

  return {nodes, edges, children, roots}
}

/**
 * Where each Turn goes, from the Tree's structure and the boxes' measured
 * sizes alone (ADR 0019): a tidy tree in which every subtree gets the room it
 * needs across the reading direction, Branches keep the order they were
 * started in, and a Fork sits centered over its Branches.
 */
export function layoutTree(
  index: TreeIndex,
  orientation: CanvasOrientation,
  sizeOf: (nodeId: string) => Size | undefined
): Layout {
  const vertical = orientation === 'vertical'
  const gap = GAPS[orientation]
  const graph = vertical ? turnGraph(index) : exchangeGraph(index)
  const span = new Map<string, number>()
  const positions = new Map<string, Point>()

  function size(id: string) {
    return sizeOf(id) ?? DEFAULT_SIZE
  }

  /** A box's extent in the reading direction. */
  function along(id: string) {
    return vertical ? size(id).height : size(id).width
  }

  /** A box's extent across it. */
  function across(id: string) {
    return vertical ? size(id).width : size(id).height
  }

  function childrenOf(id: string) {
    return graph.children.get(id) ?? []
  }

  function gapsBetween(kids: string[]) {
    return gap.branch * Math.max(0, kids.length - 1)
  }

  /** The room a subtree needs across the reading direction. */
  function measure(id: string): number {
    const kids = childrenOf(id)

    const total =
      kids.reduce((sum, kid) => sum + measure(kid), 0) + gapsBetween(kids)

    const result = Math.max(across(id), total)
    span.set(id, result)

    return result
  }

  function place(id: string, acrossStart: number, alongStart: number) {
    const own = span.get(id) ?? across(id)
    const centered = acrossStart + (own - across(id)) / 2

    positions.set(
      id,
      vertical ? {x: centered, y: alongStart} : {x: alongStart, y: centered}
    )

    const kids = childrenOf(id)

    const total =
      kids.reduce((sum, kid) => sum + (span.get(kid) ?? 0), 0) +
      gapsBetween(kids)

    let at = acrossStart + (own - total) / 2

    for (const kid of kids) {
      place(kid, at, alongStart + along(id) + gap.rank)
      at += (span.get(kid) ?? 0) + gap.branch
    }
  }

  let offset = 0

  for (const root of graph.roots) {
    measure(root)
    place(root, offset, 0)
    offset += (span.get(root) ?? 0) + gap.branch
  }

  return {
    nodes: graph.nodes.map(node => ({
      ...node,
      position: positions.get(node.id) ?? {x: 0, y: 0},
    })),
    edges: graph.edges,
  }
}
