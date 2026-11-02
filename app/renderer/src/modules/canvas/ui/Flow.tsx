import type {Collapsed, Expanded} from '../canvas-context'
import type {CanvasLayout, Size} from '../canvas-layout'
import type {Deleted} from '../hold'
import type {Moves} from '../motion'
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
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {layoutCanvas, startZoom} from '../canvas-layout'
import {useFollow} from '../follow'
import {useHold} from '../hold'
import {useReducedMotion} from '../reduced-motion'
import {slideMs} from '../slide'
import {isFork} from '../tree'
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
  switching: boolean
  showMap: boolean
  moving: boolean
  moves: Moves
  onHover: (turnId: string | null) => void
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
  switching,
  showMap,
  moving,
  moves,
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
    moves,
  })

  const allMeasured =
    canvasLayout.nodes.length > 0 &&
    canvasLayout.nodes.every(node => measured[node.id] !== undefined)

  const release = useHold({
    canvasLayout,
    collapsed,
    expanded,
    deleted,
    measured,
    allMeasured,
    nodeIdOf,
    letGo,
    moves,
  })

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

    moves.jump(async () => {
      const fit = await flow.fitView(FIT)
      setFitted(true)

      return fit
    })
  }, [fitted, allMeasured, flow, moves])

  const hasFork = index.replies.some(reply => isFork(index, reply.id))

  // The first Fork made here zooms out just enough to show the whole Tree, in
  // place of the pan to its Reply; a Tree loaded with Forks was fitted on load.
  const [forkShown, setForkShown] = useState(hasFork)
  const [centered, setCentered] = useState(0)

  useEffect(() => {
    if (forkShown || !hasFork || !allMeasured) return

    // oxlint-disable-next-line react/set-state-in-effect -- the render it causes ends the canvas's wait
    setForkShown(true)

    if (focus) setCentered(focus.sequence)

    async function fitAll() {
      await moves.glide(async () =>
        flow.fitView({
          padding: 0.15,
          maxZoom: flow.getZoom(),
          duration: panMs,
        })
      )

      if (focus?.mode === 'follow') follow(focus.replyId)
    }

    void fitAll()
  }, [forkShown, hasFork, allMeasured, focus, flow, panMs, follow, moves])

  // A focus waits for its Reply's box to have a size, and while the first Fork
  // waits to be fitted, the fit takes it instead. A Reply folded away is not
  // panned to, then or once it is unfolded.
  useEffect(() => {
    if (!focus || centered === focus.sequence) return

    if (hasFork && !forkShown) return

    const nodeId = nodeIdOf(focus.replyId)
    const node = canvasLayout.nodes.find(candidate => candidate.id === nodeId)
    const size = measured[nodeId]

    if (!node && index.replyById.has(focus.replyId)) {
      // oxlint-disable-next-line react/set-state-in-effect -- the render it causes ends the canvas's wait
      setCentered(focus.sequence)

      return
    }

    if (!node || !size) return

    setCentered(focus.sequence)
    release()

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

    void moves.glide(async () =>
      flow.setCenter(center.x, center.y, {
        zoom: focus.mode === 'input' ? startZoom(canvasWidth) : flow.getZoom(),
        duration: panMs,
        interpolate: 'linear',
      })
    )
  }, [
    focus,
    centered,
    hasFork,
    forkShown,
    nodeIdOf,
    canvasLayout,
    index,
    measured,
    flow,
    panMs,
    follow,
    unfollow,
    canvasWidth,
    moves,
    release,
  ])

  const waiting =
    !fitted ||
    !allMeasured ||
    (hasFork && !forkShown) ||
    (focus !== null && centered !== focus.sequence)

  return (
    <ReactFlow<TurnNode>
      ref={pane}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      defaultViewport={startAt ?? undefined}
      onMoveStart={event => {
        if (event) moves.stop()

        onMoveStart(event)
      }}
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
      // Tests wait on it before reading the viewport.
      data-moving={moving || waiting ? '' : undefined}
      className={cn(
        switching && 'canvas-switching',
        !fitted && 'canvas-fitting'
      )}
      onNodeMouseEnter={(_event, node) => onHover(hoverIdOf(node))}
      onNodeMouseLeave={() => onHover(null)}
    >
      <Background gap={24} />
      {showMap && (
        <div
          className="contents"
          onPointerDown={moves.stop}
          onWheel={moves.stop}
        >
          <MiniMap
            pannable
            zoomable
            ariaLabel="Minimap"
            position="bottom-left"
            className="overflow-hidden rounded-xl border border-border shadow-md"
            style={{width: 220, height: 130}}
          />
        </div>
      )}
    </ReactFlow>
  )
}
