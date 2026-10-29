import type {Collapsed} from '../canvas-context'
import type {Layout, Size} from '../layout'
import type {TreeIndex} from '../tree'
import type {Stem, TurnNode} from './TurnNodes'
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
import {useReducedMotion} from '../reduced-motion'
import {isFork} from '../tree'
import {CanvasControls} from './CanvasControls'
import {ExchangeNode, PromptNode, ReplyNode} from './TurnNodes'

/** A request to center a Reply; every request gets a new sequence. */
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
  switching: boolean
  onHover: (turnId: string | null) => void
  onOrientation: (orientation: CanvasOrientation) => void
  onJump: (replyId: string) => void
}

type Sizes = Record<CanvasOrientation, Record<string, Size>>

const NO_SIZES: Sizes = {vertical: {}, horizontal: {}}

const FIT = {padding: 0.15, maxZoom: 1}

const nodeTypes = {prompt: PromptNode, reply: ReplyNode, exchange: ExchangeNode}

function isOnThread(
  edge: Layout['edges'][number],
  thread: ReadonlySet<string>
) {
  return thread.has(edge.source) && thread.has(edge.target)
}

function stemOf(
  nodeId: string,
  layout: Layout,
  thread: ReadonlySet<string>
): Stem {
  const outgoing = layout.edges.filter(edge => edge.source === nodeId)

  if (outgoing.length === 0) return 'none'

  return outgoing.some(edge => isOnThread(edge, thread)) ? 'on-thread' : 'plain'
}

function hoverIdOf(node: TurnNode) {
  const {turn} = node.data

  return turn.kind === 'exchange' ? (turn.reply?.id ?? turn.prompt.id) : node.id
}

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
  const panMs = useReducedMotion() ? 0 : 400
  // Per orientation: the same id is a Prompt box in one and an Exchange card in the other.
  const [sizes, setSizes] = useState<Sizes>(NO_SIZES)
  const measured = sizes[orientation]

  const layout = useMemo(
    () => layoutTree(index, orientation, id => measured[id], collapsed.ids),
    [index, orientation, measured, collapsed.ids]
  )

  const nodeIdOf = useCallback(
    (replyId: string) =>
      orientation === 'vertical'
        ? replyId
        : (index.replyById.get(replyId)?.promptId ?? replyId),
    [orientation, index]
  )

  const allMeasured =
    layout.nodes.length > 0 &&
    layout.nodes.every(node => measured[node.id] !== undefined)

  // Folding or unfolding a Fork moves its Reply in the layout, and again as the
  // boxes it shows are measured; the viewport moves by the same amount, scaled,
  // so the Reply stays where it is on screen. A pan lets it go.
  const lastLayout = useRef(layout)
  const lastCollapsed = useRef(collapsed)
  const heldReplyId = useRef<string | null>(null)

  useLayoutEffect(() => {
    const before = lastLayout.current
    lastLayout.current = layout

    if (lastCollapsed.current !== collapsed) {
      lastCollapsed.current = collapsed
      heldReplyId.current = collapsed.toggledReplyId
    }

    const replyId = heldReplyId.current

    if (replyId === null) return

    if (allMeasured) heldReplyId.current = null

    const nodeId = nodeIdOf(replyId)
    const from = before.nodes.find(node => node.id === nodeId)?.position
    const to = layout.nodes.find(node => node.id === nodeId)?.position

    if (!from || !to) return

    const {x, y, zoom} = flow.getViewport()

    void flow.setViewport({
      x: x - (to.x - from.x) * zoom,
      y: y - (to.y - from.y) * zoom,
      zoom,
    })
  }, [layout, collapsed, allMeasured, nodeIdOf, flow])

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
        data: {
          turn,
          stem:
            turn.kind === 'reply' ? stemOf(turn.id, layout, thread) : 'none',
        },
        measured: measured[turn.id],
        draggable: false,
        selectable: false,
      })),
    [layout, measured, thread]
  )

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map(edge => {
        const highlighted = isOnThread(edge, thread)

        return {
          ...edge,
          type: 'smoothstep',
          className: highlighted ? 'on-thread' : undefined,
          zIndex: highlighted ? 1 : 0,
        }
      }),
    [layout, thread]
  )

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

    void flow.fitView({
      padding: 0.15,
      maxZoom: flow.getZoom(),
      duration: panMs,
    })
  }, [hasFork, allMeasured, focus, flow, panMs])

  // Each focus pans to its Reply at the current zoom, once the Reply's box has
  // a size; while the first Fork waits to be fitted, the fit takes it instead.
  // A Reply folded away is not panned to, then or once it is unfolded.
  useEffect(() => {
    if (!focus || centered.current === focus.sequence) return

    if (hasFork && !forkShown.current) return

    const nodeId = nodeIdOf(focus.replyId)
    const node = layout.nodes.find(candidate => candidate.id === nodeId)
    const size = measured[nodeId]

    if (!node && index.replyById.has(focus.replyId)) {
      centered.current = focus.sequence

      return
    }

    if (!node || !size) return

    centered.current = focus.sequence
    heldReplyId.current = null
    void flow.setCenter(
      node.position.x + size.width / 2,
      node.position.y + size.height / 2,
      {zoom: flow.getZoom(), duration: panMs, interpolate: 'linear'}
    )
  }, [focus, hasFork, nodeIdOf, layout, index, measured, flow, panMs])

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
