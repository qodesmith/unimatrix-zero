import type {Collapsed} from '../canvas-context'
import type {Size} from '../layout'
import type {TreeIndex} from '../tree'
import type {TurnNode} from './TurnNodes'
import type {CanvasOrientation} from '@uz/contract/settings'
import type {Edge, NodeChange} from '@xyflow/react'

import {Background, ReactFlow, useReactFlow} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {layoutTree} from '../layout'
import {isFork} from '../tree'
import {CanvasControls} from './CanvasControls'
import {ExchangeNode, PromptNode, ReplyNode} from './TurnNodes'

/**
 * A request to bring a Reply to the center; each request has a new sequence
 * number.
 */
export interface Focus {
  replyId: string
  sequence: number
}

interface FlowProps {
  index: TreeIndex
  orientation: CanvasOrientation
  /** The Turn ids on the highlighted Thread. */
  thread: ReadonlySet<string>
  collapsed: Collapsed
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
  collapsed,
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
    () => layoutTree(index, orientation, id => measured[id], collapsed.ids),
    [index, orientation, measured, collapsed.ids]
  )

  // The node a Reply is drawn in: its own box, or its Exchange's card.
  const nodeIdOf = useCallback(
    (replyId: string) =>
      orientation === 'vertical'
        ? replyId
        : (index.replyById.get(replyId)?.promptId ?? replyId),
    [orientation, index]
  )

  // Folding or unfolding a Fork moves its Reply in the layout; the viewport
  // moves by the same amount, scaled, so the Reply stays where it is on screen.
  const lastLayout = useRef(layout)
  const lastCollapsed = useRef(collapsed)

  useLayoutEffect(() => {
    const before = lastLayout.current
    const wasCollapsed = lastCollapsed.current
    lastLayout.current = layout
    lastCollapsed.current = collapsed

    if (wasCollapsed === collapsed || collapsed.toggledReplyId === null) return

    const nodeId = nodeIdOf(collapsed.toggledReplyId)
    const from = before.nodes.find(node => node.id === nodeId)?.position
    const to = layout.nodes.find(node => node.id === nodeId)?.position

    if (!from || !to) return

    const {x, y, zoom} = flow.getViewport()

    void flow.setViewport({
      x: x - (to.x - from.x) * zoom,
      y: y - (to.y - from.y) * zoom,
      zoom,
    })
  }, [layout, collapsed, nodeIdOf, flow])

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

  const hasFork = index.replies.some(reply => isFork(index, reply.id))

  // The first Fork made here zooms out just enough to show the whole Tree, in
  // place of the pan to its Reply; a Tree loaded with Forks was fitted on load.
  const forkShown = useRef(hasFork)
  const centered = useRef(0)

  useEffect(() => {
    if (forkShown.current || !hasFork || !allMeasured) return

    forkShown.current = true

    if (focus) centered.current = focus.sequence

    void flow.fitView({padding: 0.15, maxZoom: flow.getZoom(), duration: 400})
  }, [hasFork, allMeasured, focus, flow])

  // Each focus pans to its Reply at the current zoom, once the Reply's box has
  // a size; while the first Fork waits to be fitted, the fit takes it instead.
  useEffect(() => {
    if (!focus || centered.current === focus.sequence) return

    if (hasFork && !forkShown.current) return

    const nodeId = nodeIdOf(focus.replyId)
    const node = layout.nodes.find(candidate => candidate.id === nodeId)
    const size = measured[nodeId]

    if (!node || !size) return

    centered.current = focus.sequence
    void flow.setCenter(
      node.position.x + size.width / 2,
      node.position.y + size.height / 2,
      {zoom: flow.getZoom(), duration: 400, interpolate: 'linear'}
    )
  }, [focus, hasFork, nodeIdOf, layout, measured, flow])

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
