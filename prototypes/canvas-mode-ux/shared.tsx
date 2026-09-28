// PROTOTYPE: shared bits for the Canvas mode UX variants. Throw away.
import {
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import {
  contextSize,
  formatTokens,
  pathTo,
  subtreeIds,
  type Tree,
  type TreeSim,
  type Turn,
} from './tree'

// ---------- layout: data decides position, React Flow measures size ----------

export function useTreeLayout(
  base: Node[],
  edges: Edge[],
  dir: 'TB' | 'LR',
  gap = {rank: 48, node: 32}
) {
  const sizes = useRef<Record<string, {width: number; height: number}>>({})
  const [version, bump] = useReducer((x: number) => x + 1, 0)

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    let changed = false
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue
      const prev = sizes.current[c.id]
      if (
        !prev ||
        prev.width !== c.dimensions.width ||
        prev.height !== c.dimensions.height
      ) {
        sizes.current[c.id] = c.dimensions
        changed = true
      }
    }
    if (changed) bump()
  }, [])

  const nodes = useMemo(() => {
    // Tidy tree: each subtree gets the cross-axis room it needs; Branches keep creation order.
    const size = (id: string) => sizes.current[id] ?? {width: 300, height: 80}
    const main = (id: string) =>
      dir === 'TB' ? size(id).height : size(id).width
    const cross = (id: string) =>
      dir === 'TB' ? size(id).width : size(id).height
    const kids: Record<string, string[]> = {}
    const hasParent = new Set<string>()
    for (const e of edges) {
      ;(kids[e.source] ??= []).push(e.target)
      hasParent.add(e.target)
    }
    const span: Record<string, number> = {}
    const measure = (id: string): number => {
      const cs = kids[id] ?? []
      const total =
        cs.reduce((sum, c) => sum + measure(c), 0) +
        gap.node * Math.max(0, cs.length - 1)
      return (span[id] = Math.max(cross(id), total))
    }
    const pos: Record<string, {x: number; y: number}> = {}
    const place = (id: string, crossStart: number, mainStart: number) => {
      const c = crossStart + (span[id]! - cross(id)) / 2
      pos[id] = dir === 'TB' ? {x: c, y: mainStart} : {x: mainStart, y: c}
      const cs = kids[id] ?? []
      const total =
        cs.reduce((sum, k) => sum + span[k]!, 0) +
        gap.node * Math.max(0, cs.length - 1)
      let at = crossStart + (span[id]! - total) / 2
      for (const k of cs) {
        place(k, at, mainStart + main(id) + gap.rank)
        at += span[k]! + gap.node
      }
    }
    let offset = 0
    for (const n of base) {
      if (hasParent.has(n.id)) continue
      measure(n.id)
      place(n.id, offset, 0)
      offset += span[n.id]! + gap.node
    }
    return base.map(n => {
      const s = sizes.current[n.id]
      return {
        ...n,
        position: pos[n.id] ?? {x: 0, y: 0},
        ...(s ? {measured: s} : {}),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, edges, dir, version])

  return {nodes, onNodesChange}
}

// Pan to a freshly created Reply so the user sees it stream.
export function FocusOnSubmit({focus}: {focus: TreeSim['focus']}) {
  const rf = useReactFlow()
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => {
      const n = rf.getNode(focus.id)
      if (!n) return
      const w = n.measured?.width ?? 300
      const h = n.measured?.height ?? 80
      rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
        zoom: rf.getZoom(),
        duration: 400,
      })
    }, 300)
    return () => clearTimeout(t)
  }, [focus?.n])
  return null
}

// fitView on mount runs before nodes are measured; refit once after the first real layout.
export function FitOnceMeasured() {
  const rf = useReactFlow()
  const done = useRef(false)
  useEffect(() => {
    const t = setInterval(() => {
      if (done.current) return clearInterval(t)
      if (rf.getNodes().every(n => n.measured)) {
        done.current = true
        rf.fitView({padding: 0.15, maxZoom: 0.9})
      }
    }, 100)
    return () => clearInterval(t)
  }, [])
  return null
}

export const canvasProps = {
  nodesDraggable: false,
  nodesConnectable: false,
  elementsSelectable: false,
  // Without a node handler React Flow sets pointer-events: none on non-selectable nodes, killing hover and clicks.
  onNodeClick: () => {},
  onNodeMouseEnter: () => {},
  panOnScroll: true,
  zoomOnPinch: true,
  minZoom: 0.1,
  maxZoom: 1.5,
  fitView: true,
  fitViewOptions: {padding: 0.15, maxZoom: 0.9},
  proOptions: {hideAttribution: true},
} as const

export const threadIds = (tree: Tree, id: string | null) =>
  new Set(id && tree[id] ? pathTo(tree, id).map(t => t.id) : [])

// ---------- Input ----------

export function PromptInput({
  onSubmit,
  autoFocus,
  branching,
  compact,
  onFocusChange,
  blurOnSend,
}: {
  onSubmit: (text: string) => void
  autoFocus?: boolean
  branching: boolean
  compact?: boolean
  onFocusChange?: (focused: boolean) => void
  blurOnSend?: boolean
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const send = () => {
    if (!text.trim()) return
    onSubmit(text.trim())
    setText('')
    if (blurOnSend) ref.current?.blur()
  }
  return (
    <div className="nodrag nopan nowheel">
      {branching && (
        <div className="mb-1 text-[10px] font-medium tracking-wide text-amber-700 uppercase">
          New Branch
        </div>
      )}
      <div
        className={`flex items-end gap-1 rounded-xl border bg-white shadow-sm ${branching ? 'border-amber-300' : 'border-zinc-300'}`}
      >
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          rows={compact ? 1 : 2}
          value={text}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={branching ? 'Branch from here…' : 'Reply…'}
          className="flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={send}
          className="m-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white hover:bg-zinc-700"
        >
          ↑
        </button>
      </div>
    </div>
  )
}

// ---------- Context size ----------

export function ContextBadge({
  tree,
  reply,
  className = '',
}: {
  tree: Tree
  reply: Turn
  className?: string
}) {
  const prompt = reply.parentId ? tree[reply.parentId] : undefined
  const ctx = contextSize(tree, reply.id)
  return (
    <span
      className={`group/ctx relative cursor-default rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 ${className}`}
    >
      {formatTokens(ctx)} ctx
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 whitespace-nowrap text-white group-hover/ctx:block">
        This Turn: Prompt {formatTokens(prompt?.tokens ?? 0)} + Reply{' '}
        {formatTokens(reply.tokens)}
        <br />
        Thread up to here: {formatTokens(ctx)}
      </span>
    </span>
  )
}

// ---------- Delete from a Prompt ----------

export function DeleteButton({
  tree,
  promptId,
  onDelete,
  className = '',
}: {
  tree: Tree
  promptId: string
  onDelete: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const count = subtreeIds(tree, promptId).length
  if (armed)
    return (
      <span
        className={`nodrag inline-flex items-center gap-1 text-[11px] ${className}`}
        onMouseLeave={() => setArmed(false)}
      >
        <button
          onClick={onDelete}
          className="rounded bg-red-600 px-1.5 py-0.5 text-white"
        >
          Delete {count === 1 ? 'this Prompt' : `${count} Turns`}
        </button>
        <button onClick={() => setArmed(false)} className="text-zinc-500">
          Cancel
        </button>
      </span>
    )
  return (
    <button
      onClick={() => setArmed(true)}
      title="Delete this Prompt and everything below it"
      className={`nodrag text-zinc-400 hover:text-red-600 ${className}`}
    >
      🗑
    </button>
  )
}

// ---------- Status controls ----------

export function StatusBar({reply, sim}: {reply: Turn; sim: TreeSim}) {
  if (reply.status === 'streaming')
    return (
      <button
        onClick={() => sim.stop(reply.id)}
        className="nodrag rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] hover:bg-zinc-100"
      >
        ■ Stop
      </button>
    )
  if (reply.status === 'failed')
    return (
      <span className="flex items-center gap-2 text-[11px] text-red-700">
        Reply failed
        <button
          onClick={() => sim.retry(reply.id)}
          className="nodrag rounded-md bg-red-600 px-2 py-0.5 text-white hover:bg-red-500"
        >
          ↻ Retry
        </button>
      </span>
    )
  if (reply.status === 'stopped')
    return (
      <span className="rounded-md bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600">
        Stopped
      </span>
    )
  return null
}

export const Cursor = () => (
  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-zinc-800 align-middle" />
)

export const canRespond = (reply: Turn) =>
  reply.status === 'done' || reply.status === 'stopped'

// ---------- prototype chrome ----------

export function DebugPanel({sim}: {sim: TreeSim}) {
  const turns = Object.values(sim.tree)
  const streaming = turns.filter(t => t.status === 'streaming').length
  const active = sim.tree[sim.activeReplyId]
  return (
    <div className="fixed top-3 left-3 z-50 w-64 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-2.5 font-mono text-[11px] text-fuchsia-950 shadow">
      <div className="mb-1 font-bold">PROTOTYPE · Canvas mode UX</div>
      <div>
        Turns: {turns.length} · streaming: {streaming}
      </div>
      <div className="truncate">
        Active Reply:{' '}
        {active ? `${active.id} "${active.text.slice(0, 30)}"` : 'none'}
      </div>
      <label className="mt-1.5 flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={sim.failNext}
          onChange={e => sim.setFailNext(e.target.checked)}
        />
        Fail the next Reply mid-stream
      </label>
      <button
        onClick={sim.reset}
        className="mt-1.5 rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100"
      >
        Reset Tree
      </button>
      <div className="mt-1.5 text-fuchsia-700">
        Scroll = pan · pinch/⌘-scroll = zoom
      </div>
    </div>
  )
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: {key: string; name: string}[]
  current: string
  onChange: (k: string) => void
}) {
  const idx = Math.max(
    0,
    variants.findIndex(v => v.key === current)
  )
  const go = useCallback(
    (d: number) =>
      onChange(variants[(idx + d + variants.length) % variants.length]!.key),
    [idx, variants, onChange]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      )
        return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])
  const v = variants[idx]!
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-700 px-3 py-1.5 font-mono text-sm text-white shadow-lg">
      <button onClick={() => go(-1)} className="px-1 hover:text-fuchsia-200">
        ←
      </button>
      <span>
        {v.key} ({v.name})
      </span>
      <button onClick={() => go(1)} className="px-1 hover:text-fuchsia-200">
        →
      </button>
    </div>
  )
}

// Node components read the sim from context so node data stays small.
import {createContext, useContext} from 'react'
export const SimContext = createContext<TreeSim | null>(null)
export const useSim = () => useContext(SimContext)!
