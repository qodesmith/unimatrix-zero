// PROTOTYPE variant D: Canvas mode, converged. A's Turn boxes (vertical) and B's exchange cards (horizontal)
// behind an orientation toggle, plus a chat drawer for reading and continuing a Thread. Throw away.
import {
  Background,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Node,
  type XYPosition,
} from '@xyflow/react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'

import {
  AttachmentList,
  CanvasFeatures,
  canRespond,
  canvasProps,
  centerNode,
  Cursor,
  edgeStyle,
  FitOnceMeasured,
  FocusOnSubmit,
  LightboxContext,
  PromptInput,
  StatusBar,
  ThreadContextSize,
  threadIds,
  useHighlight,
  useHighlightTarget,
  useReportTyping,
  useSim,
  useTreeLayout,
} from './shared'
import {childrenOf, hiddenIds, pathTo, type Attachment, type Tree} from './tree'
import {PromptNode, ReplyNode, turnGraph} from './VariantA'
import {ExchangeNode, exchangeGraph} from './VariantB'

export const name = 'Canvas mode, converged'

type Orientation = 'vertical' | 'horizontal'
const ORIENTATION_KEY = 'canvas-mode-orientation'
const DRAWER_WIDTH = 440
// Reading width of the chat column in full screen; a no-op inside the narrower drawer.
const COLUMN = 'w-full max-w-[720px]'
const SWITCH_MS = 500
// Where a Reply box sits relative to its card when gliding in or out of it.
const CARD_BODY = {x: 0, y: 44}

const nodeTypes = {prompt: PromptNode, reply: ReplyNode, exchange: ExchangeNode}
const FEATURES = {collapse: true, attach: true}

// Horizontal cards are keyed by Prompt id, so a Reply lives in its Prompt's card.
const nodeIdFor = (tree: Tree, turnId: string, o: Orientation) =>
  o === 'horizontal' && tree[turnId]?.kind === 'reply'
    ? tree[turnId]!.parentId!
    : turnId

// The drawer shows root → a Reply; a clicked Prompt stands for its Reply.
const threadEnd = (tree: Tree, turnId: string | null) => {
  const t = turnId ? tree[turnId] : undefined
  if (!t) return null
  return t.kind === 'reply' ? t.id : (childrenOf(tree, t.id)[0]?.id ?? null)
}

const offsetBy = (p: XYPosition, d: XYPosition) => ({
  x: p.x + d.x,
  y: p.y + d.y,
})

export function VariantD() {
  const sim = useSim()
  const rf = useReactFlow()
  const [orientation, setOrientation] = useState<Orientation>(() =>
    localStorage.getItem(ORIENTATION_KEY) === 'horizontal'
      ? 'horizontal'
      : 'vertical'
  )
  // 'start': entering nodes sit at their origin for a frame; 'run': everything glides to its new spot.
  const [switching, setSwitching] = useState<null | 'start' | 'run'>(null)
  const before = useRef<Record<string, Node>>({})
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [lightbox, setLightbox] = useState<Attachment | null>(null)
  const drawerReplyId = threadEnd(sim.tree, selected)
  const drawerOffset = drawerReplyId ? DRAWER_WIDTH / 2 : 0
  const empty = Object.keys(sim.tree).length === 0

  useEffect(() => {
    if (selected && !drawerReplyId) setSelected(null)
    if (!drawerReplyId) setFull(false)
  }, [selected, drawerReplyId])

  // A fresh Tree starts at a readable zoom rather than wherever the old one was fitted.
  useEffect(() => {
    if (empty) rf.zoomTo(1)
  }, [empty])

  // A file dropped beside an Input shouldn't navigate away to it.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const vertical = orientation === 'vertical'
  const hidden = useMemo(
    () => hiddenIds(sim.tree, sim.collapsed),
    [sim.tree, sim.collapsed]
  )
  const {base, edges} = useMemo(() => {
    const g = vertical ? turnGraph(sim.tree) : exchangeGraph(sim.tree)
    if (!hidden.size) return g
    return {
      base: g.base.filter(n => !hidden.has(n.id)),
      edges: g.edges.filter(e => !hidden.has(e.target)),
    }
  }, [sim.tree, vertical, hidden])

  // Collapsing or expanding glides the remaining Turns to their new spots, reusing the orientation switch's transition.
  const [reflowing, setReflowing] = useState(false)
  const collapseSeen = useRef(sim.collapsed)
  useEffect(() => {
    if (collapseSeen.current === sim.collapsed) return
    collapseSeen.current = sim.collapsed
    setReflowing(true)
    const t = setTimeout(() => setReflowing(false), SWITCH_MS)
    return () => clearTimeout(t)
  }, [sim.collapsed])
  const {nodes: laid, onNodesChange} = useTreeLayout(
    base as Node[],
    edges,
    vertical ? 'TB' : 'LR',
    vertical ? {rank: 40, node: 36} : {rank: 30, node: 28}
  )

  const nodes = useMemo(() => {
    const selectedNode = selected && nodeIdFor(sim.tree, selected, orientation)
    let out: Node[] = laid.map(n => ({...n, selected: n.id === selectedNode}))
    if (switching && !vertical) {
      // Reply boxes glide into their card and fade out.
      const cards = Object.fromEntries(laid.map(n => [n.id, n.position]))
      for (const t of Object.values(sim.tree)) {
        const card = t.kind === 'reply' && cards[t.parentId!]
        const prev = before.current[t.id]
        if (card && prev)
          out.push({
            ...prev,
            data: {turn: t},
            position: offsetBy(card, CARD_BODY),
            selected: false,
            className: 'turn-exit',
          })
      }
    }
    if (switching === 'start' && vertical) {
      // Reply boxes start inside the card they're leaving, then glide out on 'run'.
      out = out.map(n => {
        const card =
          n.type === 'reply' &&
          before.current[sim.tree[n.id]?.parentId ?? '']?.position
        return card
          ? {...n, position: offsetBy(card, CARD_BODY), className: 'turn-enter'}
          : n
      })
    }
    // Same DOM order in both orientations, so React never moves a node mid-transition.
    const order = (id: string) => sim.tree[id]?.createdAt ?? 0
    return out.sort((a, b) => order(a.id) - order(b.id))
  }, [laid, switching, vertical, selected, sim.tree, orientation])

  const switchTo = (o: Orientation) => {
    if (o === orientation) return
    localStorage.setItem(ORIENTATION_KEY, o)
    before.current = Object.fromEntries(rf.getNodes().map(n => [n.id, n]))
    timers.current.forEach(clearTimeout)
    setOrientation(o)
    setSwitching('start')
    const focusTurn = selected ?? sim.activeReplyId
    timers.current = [
      setTimeout(() => setSwitching('run'), 30),
      // Let the new layout settle (fresh sizes get measured) before centering.
      setTimeout(
        () => centerNode(rf, nodeIdFor(sim.tree, focusTurn, o), drawerOffset),
        120
      ),
      setTimeout(() => setSwitching(null), SWITCH_MS),
    ]
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const {setHoverId, setPinnedId} = useHighlight()
  useEffect(() => {
    setPinnedId(drawerReplyId)
    return () => setPinnedId(null)
  }, [drawerReplyId, setPinnedId])
  const target = useHighlightTarget()
  const styledEdges = useMemo(() => {
    const thread = threadIds(sim.tree, target)
    return edges.map(e => ({
      ...e,
      ...edgeStyle(thread.has(e.source) && thread.has(e.target)),
    }))
  }, [edges, sim.tree, target])

  // Esc, like the Claude CLI, innermost first: lightbox, the drawer's streaming Reply, full screen, the drawer, the active Reply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const drawerReply = drawerReplyId ? sim.tree[drawerReplyId] : undefined
      const active = sim.tree[sim.activeReplyId]
      if (lightbox) setLightbox(null)
      else if (drawerReply?.status === 'streaming') sim.stop(drawerReply.id)
      else if (full) setFull(false)
      else if (drawerReply) setSelected(null)
      else if (active?.status === 'streaming') sim.stop(active.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sim, drawerReplyId, lightbox, full])

  // Expands collapsed ancestors first, then centers once the reflowed layout has measured.
  const jumpTo = (turnId: string, offsetX = drawerOffset) => {
    const wasHidden = hidden.has(turnId)
    sim.reveal(turnId)
    const go = () =>
      centerNode(rf, nodeIdFor(sim.tree, turnId, orientation), offsetX)
    if (wasHidden) setTimeout(go, 200)
    else go()
  }

  const streamingIds = Object.values(sim.tree)
    .filter(t => t.kind === 'reply' && t.status === 'streaming')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(t => t.id)
  const failedIds = sim.unseenFailures.filter(
    id => sim.tree[id]?.status === 'failed'
  )
  const lastStreamingJump = useRef<string | null>(null)
  const jumpToStreaming = () => {
    const i = streamingIds.indexOf(lastStreamingJump.current ?? '')
    const id = streamingIds[(i + 1) % streamingIds.length]
    if (!id) return
    lastStreamingJump.current = id
    jumpTo(id)
  }
  const jumpToFailed = () => {
    const id = failedIds[0]
    if (!id) return
    sim.dismissFailure(id)
    jumpTo(id)
  }

  const openDrawer = (e: MouseEvent) => {
    const el = e.target as HTMLElement
    if (el.closest('button, input, textarea, .nodrag')) return
    if (window.getSelection()?.toString()) return
    const turnId = el.closest<HTMLElement>('[data-turn]')?.dataset.turn
    if (!turnId || !sim.tree[turnId]) return
    setSelected(turnId)
    jumpTo(turnId, DRAWER_WIDTH / 2)
  }

  return (
    <CanvasFeatures.Provider value={FEATURES}>
      <LightboxContext.Provider value={setLightbox}>
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          {...canvasProps}
          className={switching || reflowing ? 'canvas-switching' : ''}
          onNodeClick={openDrawer}
          onNodeMouseEnter={(_, n) =>
            setHoverId(n.type === 'exchange' ? threadEnd(sim.tree, n.id) : n.id)
          }
          onNodeMouseLeave={() => setHoverId(null)}
        >
          <Background gap={24} color="#d4d4d8" />
          <CanvasControls
            orientation={orientation}
            onOrientation={switchTo}
            streaming={streamingIds.length}
            failed={failedIds.length}
            onJumpStreaming={jumpToStreaming}
            onJumpFailed={jumpToFailed}
          />
          <FitOnceMeasured />
          <FocusOnSubmit
            focus={
              sim.focus && {
                ...sim.focus,
                id: nodeIdFor(sim.tree, sim.focus.id, orientation),
              }
            }
            offsetX={drawerOffset}
          />
        </ReactFlow>
        {empty && (
          <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
            <div className="pointer-events-auto w-[560px]">
              <PromptInput
                large
                autoFocus
                attachable
                branching={false}
                placeholder="Start a new conversation…"
                onSubmit={(t, a) => sim.submit(null, t, a)}
              />
              <p className="mt-2 text-center text-xs text-zinc-400">
                Enter to send · attach with 📎, paste or drop files
              </p>
            </div>
          </div>
        )}
        {drawerReplyId && (
          <ChatDrawer
            replyId={drawerReplyId}
            full={full}
            onToggleFull={() => setFull(f => !f)}
            onClose={() => setSelected(null)}
            onSent={setSelected}
          />
        )}
        {lightbox && (
          <div
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/80 p-10"
          >
            <img
              src={lightbox.url}
              alt={lightbox.name}
              className="max-h-[85vh] max-w-full rounded-lg bg-white shadow-2xl"
            />
            <span className="text-sm text-zinc-300">{lightbox.name}</span>
          </div>
        )}
      </LightboxContext.Provider>
    </CanvasFeatures.Provider>
  )
}

// Minimap on top, zoom buttons and the orientation toggle beneath, as one control.
function CanvasControls({
  orientation,
  onOrientation,
  streaming,
  failed,
  onJumpStreaming,
  onJumpFailed,
}: {
  orientation: Orientation
  onOrientation: (o: Orientation) => void
  streaming: number
  failed: number
  onJumpStreaming: () => void
  onJumpFailed: () => void
}) {
  const rf = useReactFlow()
  return (
    <Panel
      position="bottom-left"
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-md"
    >
      {(streaming > 0 || failed > 0) && (
        <div className="flex items-center gap-1 border-b border-zinc-200 p-1 text-[11px]">
          {streaming > 0 && (
            <button
              onClick={onJumpStreaming}
              title="Jump to the next streaming Reply"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-violet-700 hover:bg-violet-50"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
              </span>
              {streaming} streaming
            </button>
          )}
          {failed > 0 && (
            <button
              onClick={onJumpFailed}
              title="Jump to the next failed Reply"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-red-700 hover:bg-red-50"
            >
              <span className="h-2 w-2 rounded-full bg-red-500" />
              {failed} failed
            </button>
          )}
        </div>
      )}
      <MiniMap
        pannable
        zoomable
        style={{position: 'relative', margin: 0, width: 268, height: 150}}
      />
      <div className="flex items-center gap-1 border-t border-zinc-200 p-1.5">
        <ToolButton title="Zoom in" onClick={() => rf.zoomIn({duration: 200})}>
          +
        </ToolButton>
        <ToolButton
          title="Zoom out"
          onClick={() => rf.zoomOut({duration: 200})}
        >
          −
        </ToolButton>
        <ToolButton
          title="Fit view"
          onClick={() =>
            rf.fitView({padding: 0.15, maxZoom: 0.9, duration: 300})
          }
        >
          ⤢
        </ToolButton>
        <span className="flex-1" />
        <div className="flex rounded-lg bg-zinc-100 p-0.5 text-[11px]">
          {(['vertical', 'horizontal'] as const).map(o => (
            <button
              key={o}
              onClick={() => onOrientation(o)}
              aria-pressed={orientation === o}
              className={`rounded-md px-2 py-1 capitalize ${orientation === o ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
    >
      {children}
    </button>
  )
}

function ChatDrawer({
  replyId,
  full,
  onToggleFull,
  onClose,
  onSent,
}: {
  replyId: string
  // Covers the canvas: the familiar full-page chat.
  full: boolean
  onToggleFull: () => void
  onClose: () => void
  onSent: (replyId: string) => void
}) {
  const sim = useSim()
  const thread = pathTo(sim.tree, replyId)
  const last = sim.tree[replyId]!
  const reportTyping = useReportTyping(replyId)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lastPromptRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(false)

  // On a new Thread end, start reading at its last Prompt; after that, follow streaming text only while at the bottom.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = (lastPromptRef.current?.offsetTop ?? el.scrollHeight) - 12
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }, [replyId])
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  })

  return (
    <aside
      style={full ? undefined : {width: DRAWER_WIDTH}}
      className={`fixed top-0 right-0 bottom-0 z-40 flex flex-col bg-zinc-50 ${full ? 'left-0 pb-12' : 'border-l border-zinc-200 shadow-xl'}`}
    >
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-500">
        <span>
          Thread · {thread.length} Turns · {last.model}
        </span>
        <span className="flex items-center gap-3">
          <button
            onClick={onToggleFull}
            title={full ? 'Back to the canvas (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            className="text-sm leading-none text-zinc-400 hover:text-zinc-900"
          >
            {full ? '⤡' : '⤢'}
          </button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="text-sm leading-none text-zinc-400 hover:text-zinc-900"
          >
            ✕
          </button>
        </span>
      </div>
      <div
        ref={bodyRef}
        onScroll={e => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="relative flex-1 overflow-y-auto px-4 py-4"
      >
        <div className={`mx-auto flex flex-col gap-3 ${COLUMN}`}>
          {thread.map((t, i) =>
            t.kind === 'prompt' ? (
              <div
                key={t.id}
                ref={i === thread.length - 2 ? lastPromptRef : undefined}
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-sky-100 px-3.5 py-2 text-sm whitespace-pre-wrap text-sky-950"
              >
                {t.attachments && (
                  <AttachmentList
                    items={t.attachments}
                    className={t.text ? 'mb-2' : ''}
                  />
                )}
                {t.text}
              </div>
            ) : (
              <div key={t.id} className="mr-6">
                <div
                  className={`rounded-2xl rounded-bl-md border bg-white px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${t.status === 'failed' ? 'border-red-300 text-zinc-400' : 'border-zinc-200 text-zinc-800'}`}
                >
                  {t.text}
                  {t.status === 'streaming' && <Cursor />}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                  {t.model}
                  <StatusBar reply={t} sim={sim} />
                </div>
              </div>
            )
          )}
        </div>
      </div>
      <div className="border-t border-zinc-200 bg-white">
        <div className={`mx-auto px-4 pt-3 pb-2 ${COLUMN}`}>
          <PromptInput
            key={replyId}
            attachable
            branching={childrenOf(sim.tree, replyId).length > 0}
            disabled={!canRespond(last)}
            onTypingChange={reportTyping}
            onSubmit={(t, a) => onSent(sim.submit(replyId, t, a))}
          />
        </div>
      </div>
      <div className={`mx-auto ${COLUMN}`}>
        <ThreadContextSize thread={thread} />
      </div>
    </aside>
  )
}
