import type {Collapsed, Expanded} from '../canvas-context'
import type {CanvasLayout, Size} from '../canvas-layout'
import type {TreeIndex} from '../tree'
import type {Stem, TurnNode} from './TurnNodes'
import type {CanvasOrientation} from '@uz/contract/settings'
import type {Edge, NodeChange, Viewport} from '@xyflow/react'

import {
  Background,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import {cn} from 'cn'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {layoutCanvas, startZoom} from '../canvas-layout'
import {useFollow} from '../follow'
import {useReducedMotion} from '../reduced-motion'
import {slideMs} from '../slide'
import {isFork} from '../tree'
import {whenTurnsArrive} from '../when-turns-arrive'
import {ExchangeNode, PromptNode, ReplyNode} from './TurnNodes'

/** A request to bring a Reply into view; every request gets a new sequence. */
export interface Focus {
  replyId: string
  /**
   * `follow` shows the Reply's bottom and keeps it shown while it streams;
   * `input` centers its Input at the zoom a new Tree starts at.
   */
  mode: 'center' | 'follow' | 'input'
  sequence: number
}

interface FlowProps {
  index: TreeIndex
  orientation: CanvasOrientation
  /** The Turn ids on the highlighted Thread. */
  thread: ReadonlySet<string>
  collapsed: Collapsed
  expanded: Expanded
  focus: Focus | null
  /** Fit the whole Tree once it is measured; off for a Tree that starts here. */
  fitOnLoad: boolean
  /** Where the root Prompt is drawn at first, and how far zoomed. */
  startAt: Viewport | null
  /** A new one each time a Prompt and every Turn below it are deleted. */
  deleted: Deleted | null
  showMap: boolean
  onHover: (turnId: string | null) => void
}

interface Deleted {
  parentReplyId: string | null
  /** Its box changes size once it is measured again. */
  resizes: boolean
}

type Sizes = Record<CanvasOrientation, Record<string, Size>>

const NO_SIZES: Sizes = {vertical: {}, horizontal: {}}

const FIT = {padding: 0.15, maxZoom: 1}

const nodeTypes = {prompt: PromptNode, reply: ReplyNode, exchange: ExchangeNode}

function isOnThread(
  edge: CanvasLayout['edges'][number],
  thread: ReadonlySet<string>
) {
  return thread.has(edge.source) && thread.has(edge.target)
}

function stemOf(
  nodeId: string,
  canvasLayout: CanvasLayout,
  thread: ReadonlySet<string>
): Stem {
  const outgoing = canvasLayout.edges.filter(edge => edge.source === nodeId)

  if (outgoing.length === 0) return 'none'

  return outgoing.some(edge => isOnThread(edge, thread)) ? 'on-thread' : 'plain'
}

/** A Turn kept where it is on screen while the canvas layout changes. */
interface Held {
  turnId: string
  /**
   * Its box's size before its text was let out or capped, held until it
   * changes.
   */
  resizing: Size | null
}

function settledSize(held: Held, size: Size | undefined) {
  return held.resizing === null || size !== held.resizing
}

function inputOf(pane: HTMLDivElement | null, nodeId: string) {
  return pane
    ?.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
    ?.querySelector('[data-revealed] form')
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
  expanded,
  focus,
  fitOnLoad,
  startAt,
  deleted,
  showMap,
  onHover,
}: FlowProps) {
  const flow = useReactFlow<TurnNode>()
  const pane = useRef<HTMLDivElement>(null)
  const canvasWidth = useStore(state => state.width)
  const reducedMotion = useReducedMotion()
  const panMs = useMemo(() => (reducedMotion ? 0 : slideMs()), [reducedMotion])
  // Per orientation: the same id is a Prompt box in one and an Exchange card in the other.
  const [sizes, setSizes] = useState<Sizes>(NO_SIZES)
  const measured = sizes[orientation]

  const canvasLayout = useMemo(
    () => layoutCanvas(index, orientation, id => measured[id], collapsed.ids),
    [index, orientation, measured, collapsed.ids]
  )

  const nodeIdOf = useCallback(
    (replyId: string) =>
      orientation === 'vertical'
        ? replyId
        : (index.replyById.get(replyId)?.promptId ?? replyId),
    [orientation, index]
  )

  const {follow, unfollow, letGo, onMoveStart, onMoveEnd} = useFollow({
    index,
    canvasLayout,
    measured,
    nodeIdOf,
    panMs,
  })

  const allMeasured =
    canvasLayout.nodes.length > 0 &&
    canvasLayout.nodes.every(node => measured[node.id] !== undefined)

  const [laidOutFor, setLaidOutFor] = useState(orientation)
  // Two switches in a row go to different orientations, so each one restarts
  // the wait, even when it lands as the last one ends.
  const [switchingTo, setSwitchingTo] = useState<CanvasOrientation | null>(null)

  if (laidOutFor !== orientation) {
    setLaidOutFor(orientation)
    setSwitchingTo(reducedMotion ? null : orientation)
  }

  useEffect(() => {
    const element = pane.current

    if (switchingTo === null || !element) return undefined

    return whenTurnsArrive(element, () => setSwitchingTo(null))
  }, [switchingTo])

  // Folding or unfolding a Fork moves its Reply in the canvas layout, and again
  // as the boxes it shows are measured; the viewport moves by the same amount,
  // scaled, so the Reply stays where it is on screen. A pan lets it go. Letting
  // out or capping a Turn's text holds its Turn the same way until its box is
  // measured anew, and lets a followed Reply go, so the text being read stays
  // put. Deleting Turns from below a Reply holds the Reply too.
  const lastCanvasLayout = useRef(canvasLayout)
  const lastCollapsed = useRef(collapsed)
  const lastExpanded = useRef(expanded)
  const lastDeleted = useRef(deleted)
  const held = useRef<Held | null>(null)

  // Declared before the effect that moves the viewport for the held Turn, so it
  // runs first in the render the Turns go.
  useLayoutEffect(() => {
    if (lastDeleted.current === deleted) return

    lastDeleted.current = deleted
    const turnId = deleted?.parentReplyId ?? null

    if (deleted === null || turnId === null) return

    held.current = {
      turnId,
      resizing: deleted.resizes ? (measured[nodeIdOf(turnId)] ?? null) : null,
    }
  }, [deleted, measured, nodeIdOf])

  useLayoutEffect(() => {
    const before = lastCanvasLayout.current
    lastCanvasLayout.current = canvasLayout

    if (lastCollapsed.current !== collapsed) {
      lastCollapsed.current = collapsed
      const turnId = collapsed.toggledReplyId
      held.current = turnId === null ? null : {turnId, resizing: null}
    }

    if (lastExpanded.current !== expanded) {
      lastExpanded.current = expanded
      const turnId = expanded.toggledTurnId

      held.current =
        turnId === null
          ? null
          : {turnId, resizing: measured[nodeIdOf(turnId)] ?? null}

      if (turnId !== null) letGo()
    }

    const {current} = held

    if (current === null) return

    const nodeId = nodeIdOf(current.turnId)

    if (allMeasured && settledSize(current, measured[nodeId]))
      held.current = null

    const from = before.nodes.find(node => node.id === nodeId)?.position
    const to = canvasLayout.nodes.find(node => node.id === nodeId)?.position

    if (!from || !to) return

    const {x, y, zoom} = flow.getViewport()

    void flow.setViewport({
      x: x - (to.x - from.x) * zoom,
      y: y - (to.y - from.y) * zoom,
      zoom,
    })
  }, [
    canvasLayout,
    collapsed,
    expanded,
    measured,
    allMeasured,
    nodeIdOf,
    flow,
    letGo,
  ])

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
      canvasLayout.nodes.map(turn => ({
        id: turn.id,
        type: turn.kind,
        position: turn.position,
        data: {
          turn,
          stem:
            turn.kind === 'reply'
              ? stemOf(turn.id, canvasLayout, thread)
              : 'none',
        },
        measured: measured[turn.id],
        draggable: false,
        selectable: false,
      })),
    [canvasLayout, measured, thread]
  )

  const edges = useMemo<Edge[]>(
    () =>
      canvasLayout.edges.map(edge => {
        const highlighted = isOnThread(edge, thread)

        return {
          ...edge,
          type: 'smoothstep',
          className: highlighted ? 'on-thread' : undefined,
          zIndex: highlighted ? 1 : 0,
        }
      }),
    [canvasLayout, thread]
  )

  const [fitted, setFitted] = useState(!fitOnLoad)

  useEffect(() => {
    if (fitted || !allMeasured) return

    void flow.fitView(FIT).then(() => setFitted(true))
  }, [fitted, allMeasured, flow])

  const hasFork = index.replies.some(reply => isFork(index, reply.id))

  // The first Fork made here zooms out just enough to show the whole Tree, in
  // place of the pan to its Reply; a Tree loaded with Forks was fitted on load.
  const forkShown = useRef(hasFork)
  const centered = useRef(0)

  useEffect(() => {
    if (forkShown.current || !hasFork || !allMeasured) return

    forkShown.current = true

    if (focus) centered.current = focus.sequence

    async function fitAll() {
      await flow.fitView({
        padding: 0.15,
        maxZoom: flow.getZoom(),
        duration: panMs,
      })

      if (focus?.mode === 'follow') follow(focus.replyId)
    }

    void fitAll()
  }, [hasFork, allMeasured, focus, flow, panMs, follow])

  // A focus waits for its Reply's box to have a size, and while the first Fork
  // waits to be fitted, the fit takes it instead. A Reply folded away is not
  // panned to, then or once it is unfolded.
  useEffect(() => {
    if (!focus || centered.current === focus.sequence) return

    if (hasFork && !forkShown.current) return

    const nodeId = nodeIdOf(focus.replyId)
    const node = canvasLayout.nodes.find(candidate => candidate.id === nodeId)
    const size = measured[nodeId]

    if (!node && index.replyById.has(focus.replyId)) {
      centered.current = focus.sequence

      return
    }

    if (!node || !size) return

    centered.current = focus.sequence
    held.current = null

    if (focus.mode === 'follow') {
      follow(focus.replyId)

      return
    }

    unfollow()

    const input =
      focus.mode === 'input'
        ? inputOf(pane.current, nodeId)?.getBoundingClientRect()
        : undefined

    const center = input
      ? flow.screenToFlowPosition({
          x: input.left + input.width / 2,
          y: input.top + input.height / 2,
        })
      : {
          x: node.position.x + size.width / 2,
          y: node.position.y + size.height / 2,
        }

    void flow.setCenter(center.x, center.y, {
      zoom: focus.mode === 'input' ? startZoom(canvasWidth) : flow.getZoom(),
      duration: panMs,
      interpolate: 'linear',
    })
  }, [
    focus,
    hasFork,
    nodeIdOf,
    canvasLayout,
    index,
    measured,
    flow,
    panMs,
    follow,
    unfollow,
    canvasWidth,
  ])

  return (
    <ReactFlow<TurnNode>
      ref={pane}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      defaultViewport={startAt ?? undefined}
      onMoveStart={onMoveStart}
      onMoveEnd={onMoveEnd}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      minZoom={0.1}
      maxZoom={1.5}
      proOptions={{hideAttribution: true}}
      className={cn(
        switchingTo !== null && 'canvas-switching',
        !fitted && 'canvas-fitting'
      )}
      onNodeMouseEnter={(_event, node) => onHover(hoverIdOf(node))}
      onNodeMouseLeave={() => onHover(null)}
    >
      <Background gap={24} />
      {showMap && (
        <MiniMap
          pannable
          zoomable
          ariaLabel="Minimap"
          position="bottom-left"
          className="overflow-hidden rounded-xl border border-border shadow-md"
          style={{width: 220, height: 130}}
        />
      )}
    </ReactFlow>
  )
}
