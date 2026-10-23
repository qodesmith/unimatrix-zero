import type {Size} from '../layout'
import type {TreeIndex} from '../tree'
import type {TurnNode} from './TurnNodes'
import type {CanvasOrientation} from '@uz/contract/settings'
import type {Edge, NodeChange} from '@xyflow/react'

import {Background, ReactFlow, useReactFlow} from '@xyflow/react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {layoutTree} from '../layout'
import {CanvasControls} from './CanvasControls'
import {ExchangeNode, PromptNode, ReplyNode} from './TurnNodes'

/** A request to bring a Reply to the center; `n` makes each request new. */
export interface Focus {
  replyId: string
  n: number
}

interface FlowProps {
  index: TreeIndex
  orientation: CanvasOrientation
  /** The Turn ids on the highlighted Thread. */
  thread: ReadonlySet<string>
  focus: Focus | null
  /** Fit the whole Tree once it is measured; off for a Tree that starts here. */
  fitOnLoad: boolean
  /** Turns glide to their new places while the orientation switches. */
  switching: boolean
  onHover: (turnId: string | null) => void
  onOrientation: (orientation: CanvasOrientation) => void
  onJump: (replyId: string) => void
}

type Sizes = Record<CanvasOrientation, Record<string, Size>>

const NO_SIZES: Sizes = {vertical: {}, horizontal: {}}

const FIT = {padding: 0.15, maxZoom: 1}

const nodeTypes = {prompt: PromptNode, reply: ReplyNode, exchange: ExchangeNode}

function hoverIdOf(node: TurnNode) {
  const {turn} = node.data

  return turn.kind === 'exchange' ? (turn.reply?.id ?? turn.prompt.id) : node.id
}

/**
 * React Flow with the Tree laid out from its structure and the boxes' measured
 * sizes. Scroll pans, pinch or ⌘-scroll zooms, and nothing can be dragged.
 */
export function Flow({
  index,
  orientation,
  thread,
  focus,
  fitOnLoad,
  switching,
  onHover,
  onOrientation,
  onJump,
}: FlowProps) {
  const flow = useReactFlow<TurnNode>()
  // Per orientation: the same id is a Prompt box in one and an Exchange card in the other.
  const [sizes, setSizes] = useState<Sizes>(NO_SIZES)
  const measured = sizes[orientation]

  const layout = useMemo(
    () => layoutTree(index, orientation, id => measured[id]),
    [index, orientation, measured]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<TurnNode>[]) => {
      const resized = changes.flatMap(change =>
        change.type === 'dimensions' && change.dimensions
          ? [[change.id, change.dimensions] as const]
          : []
      )

      if (resized.length === 0) return

      setSizes(current => {
        const known = current[orientation]

        const changed = resized.filter(
          ([id, size]) =>
            known[id]?.width !== size.width || known[id].height !== size.height
        )

        return changed.length === 0
          ? current
          : {
              ...current,
              [orientation]: {...known, ...Object.fromEntries(changed)},
            }
      })
    },
    [orientation]
  )

  const nodes = useMemo<TurnNode[]>(
    () =>
      layout.nodes.map(turn => ({
        id: turn.id,
        type: turn.kind,
        position: turn.position,
        data: {turn},
        measured: measured[turn.id],
        draggable: false,
        selectable: false,
      })),
    [layout, measured]
  )

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map(edge => {
        const highlighted = thread.has(edge.source) && thread.has(edge.target)

        return {
          ...edge,
          type: 'smoothstep',
          className: highlighted ? 'on-thread' : undefined,
          zIndex: highlighted ? 1 : 0,
        }
      }),
    [layout, thread]
  )

  const allMeasured =
    layout.nodes.length > 0 &&
    layout.nodes.every(node => measured[node.id] !== undefined)

  // Once: the first layout with real sizes shows the whole Tree.
  const fitted = useRef(!fitOnLoad)

  useEffect(() => {
    if (fitted.current || !allMeasured) return

    fitted.current = true
    void flow.fitView(FIT)
  }, [allMeasured, flow])

  // Each focus pans to its Reply at the current zoom, once the Reply's box has a size.
  const centered = useRef(0)

  useEffect(() => {
    if (!focus || centered.current === focus.n) return

    const nodeId =
      orientation === 'vertical'
        ? focus.replyId
        : (index.replyById.get(focus.replyId)?.promptId ?? focus.replyId)

    const node = layout.nodes.find(candidate => candidate.id === nodeId)
    const size = measured[nodeId]

    if (!node || !size) return

    centered.current = focus.n
    void flow.setCenter(
      node.position.x + size.width / 2,
      node.position.y + size.height / 2,
      {zoom: flow.getZoom(), duration: 400, interpolate: 'linear'}
    )
  }, [focus, orientation, index, layout, measured, flow])

  const streaming = index.replies
    .filter(reply => reply.status === 'streaming')
    .map(reply => reply.id)

  const failed = index.replies
    .filter(reply => reply.status === 'failed')
    .map(reply => reply.id)

  return (
    <ReactFlow<TurnNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={1.5}
      proOptions={{hideAttribution: true}}
      className={switching ? 'canvas-switching' : undefined}
      onNodeMouseEnter={(_event, node) => onHover(hoverIdOf(node))}
      onNodeMouseLeave={() => onHover(null)}
    >
      <Background gap={24} />
      <CanvasControls
        orientation={orientation}
        onOrientation={onOrientation}
        streaming={streaming}
        failed={failed}
        onJump={onJump}
      />
    </ReactFlow>
  )
}
