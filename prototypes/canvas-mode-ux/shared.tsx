// PROTOTYPE: shared bits for the Canvas mode UX variants. Throw away.
import {
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

import {
  childrenOf,
  contextSize,
  formatTokens,
  pathTo,
  spreadReplies,
  subtreeIds,
  type Attachment,
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
  // Sizes per direction: the same id can be a different node in each (a Prompt box vs an exchange card).
  const allSizes = useRef<
    Record<string, Record<string, {width: number; height: number}>>
  >({})
  const dirRef = useRef(dir)
  dirRef.current = dir
  const [version, bump] = useReducer((x: number) => x + 1, 0)

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sizes = (allSizes.current[dirRef.current] ??= {})
    let changed = false
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue
      const prev = sizes[c.id]
      if (
        !prev ||
        prev.width !== c.dimensions.width ||
        prev.height !== c.dimensions.height
      ) {
        sizes[c.id] = c.dimensions
        changed = true
      }
    }
    if (changed) bump()
  }, [])

  const nodes = useMemo(() => {
    const sizes = (allSizes.current[dir] ??= {})
    // Tidy tree: each subtree gets the cross-axis room it needs; Branches keep creation order.
    const size = (id: string) => sizes[id] ?? {width: 300, height: 80}
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
      const s = sizes[n.id]
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

// Smoothly center a node at the current zoom. offsetX (screen px) shifts it left, e.g. to clear a drawer.
export function centerNode(rf: ReactFlowInstance, id: string, offsetX = 0) {
  const n = rf.getNode(id)
  if (!n) return
  const w = n.measured?.width ?? 300
  const h = n.measured?.height ?? 80
  const zoom = rf.getZoom()
  rf.setCenter(n.position.x + w / 2 + offsetX / zoom, n.position.y + h / 2, {
    zoom,
    duration: 400,
  })
}

// Pan to a freshly created Reply so the user sees it stream.
export function FocusOnSubmit({
  focus,
  offsetX = 0,
}: {
  focus: TreeSim['focus']
  offsetX?: number
}) {
  const rf = useReactFlow()
  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => centerNode(rf, focus.id, offsetX), 300)
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

// ---------- Thread highlight: typing > hover > pinned (open drawer) > active ----------

type Highlight = {
  hoverId: string | null
  setHoverId: (id: string | null) => void
  typingReplyId: string | null
  setTypingReplyId: Dispatch<SetStateAction<string | null>>
  pinnedId: string | null
  setPinnedId: (id: string | null) => void
}
const HighlightContext = createContext<Highlight | null>(null)

export function HighlightProvider({children}: {children: ReactNode}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [typingReplyId, setTypingReplyId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const value = useMemo(
    () => ({
      hoverId,
      setHoverId,
      typingReplyId,
      setTypingReplyId,
      pinnedId,
      setPinnedId,
    }),
    [hoverId, typingReplyId, pinnedId]
  )
  return (
    <HighlightContext.Provider value={value}>
      {children}
    </HighlightContext.Provider>
  )
}

export const useHighlight = () => useContext(HighlightContext)!

// The Turn whose Thread gets highlighted edges.
export function useHighlightTarget() {
  const sim = useSim()
  const {hoverId, typingReplyId, pinnedId} = useHighlight()
  return typingReplyId ?? hoverId ?? pinnedId ?? sim.activeReplyId
}

// For PromptInput's onTypingChange: claims the typing highlight for this Reply, releases only its own claim.
export function useReportTyping(replyId: string) {
  const {setTypingReplyId} = useHighlight()
  return useCallback(
    (typing: boolean) =>
      setTypingReplyId(cur =>
        typing ? replyId : cur === replyId ? null : cur
      ),
    [replyId, setTypingReplyId]
  )
}

export const edgeStyle = (hot: boolean) => ({
  zIndex: hot ? 1 : 0,
  style: hot
    ? {stroke: '#8b5cf6', strokeWidth: 2.5}
    : {stroke: '#a1a1aa', strokeWidth: 1},
})

// ---------- Input ----------

const toAttachments = (files: FileList | File[]): Attachment[] =>
  Array.from(files).map(f => ({
    name: f.name || 'pasted-image.png',
    type: f.type,
    size: f.size,
    url: URL.createObjectURL(f),
  }))

export function PromptInput({
  onSubmit,
  autoFocus,
  branching,
  compact,
  large,
  placeholder,
  attachable,
  onFocusChange,
  onTypingChange,
  blurOnSend,
  disabled,
}: {
  onSubmit: (text: string, attachments: Attachment[]) => void
  autoFocus?: boolean
  branching: boolean
  compact?: boolean
  // The empty canvas's starting Input.
  large?: boolean
  placeholder?: string
  // 📎 button, paste and drop.
  attachable?: boolean
  onFocusChange?: (focused: boolean) => void
  // Fires when "focused and non-empty" flips.
  onTypingChange?: (typing: boolean) => void
  blurOnSend?: boolean
  // Keeps the Input usable for drafting but blocks sending.
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const typing = focused && (text !== '' || files.length > 0)
  const report = useRef(onTypingChange)
  report.current = onTypingChange
  useEffect(() => {
    if (!typing) return
    report.current?.(true)
    return () => report.current?.(false)
  }, [typing])
  const add = (list: FileList | File[]) => {
    if (list.length) setFiles(f => [...f, ...toAttachments(list)])
  }
  const remove = (a: Attachment) => {
    URL.revokeObjectURL(a.url)
    setFiles(f => f.filter(x => x !== a))
  }
  const send = () => {
    if (disabled || (!text.trim() && !files.length)) return
    onSubmit(text.trim(), files)
    setText('')
    setFiles([])
    if (blurOnSend) ref.current?.blur()
  }
  return (
    <div
      className="nodrag nopan nowheel"
      onDragOver={
        attachable
          ? e => {
              e.preventDefault()
              setDragOver(true)
            }
          : undefined
      }
      onDragLeave={() => setDragOver(false)}
      onDrop={
        attachable
          ? e => {
              e.preventDefault()
              setDragOver(false)
              add(e.dataTransfer.files)
            }
          : undefined
      }
    >
      {branching && (
        <div className="mb-1 text-[10px] font-medium tracking-wide text-amber-700 uppercase">
          New Branch
        </div>
      )}
      <div
        className={`rounded-xl border bg-white shadow-sm ${large ? 'rounded-2xl shadow-lg' : ''} ${dragOver ? 'border-violet-400 ring-2 ring-violet-200' : branching ? 'border-amber-300' : 'border-zinc-300'}`}
      >
        {files.length > 0 && (
          <AttachmentList
            items={files}
            onRemove={remove}
            className="px-2 pt-2"
          />
        )}
        <div className="flex items-end gap-1">
          {attachable && (
            <>
              <button
                onClick={() => picker.current?.click()}
                title="Attach files"
                aria-label="Attach files"
                className="m-1 mr-0 rounded-lg px-1.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              >
                📎
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={e => {
                  add(e.target.files ?? [])
                  e.target.value = ''
                }}
              />
            </>
          )}
          <textarea
            ref={ref}
            autoFocus={autoFocus}
            rows={large ? 3 : compact ? 1 : 2}
            value={text}
            onFocus={() => {
              setFocused(true)
              onFocusChange?.(true)
            }}
            onBlur={() => {
              setFocused(false)
              onFocusChange?.(false)
            }}
            onChange={e => setText(e.target.value)}
            onPaste={
              attachable
                ? e => {
                    if (!e.clipboardData.files.length) return
                    e.preventDefault()
                    add(e.clipboardData.files)
                  }
                : undefined
            }
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={
              placeholder ?? (branching ? 'Branch from here…' : 'Reply…')
            }
            className={`flex-1 resize-none bg-transparent px-3 py-2 outline-none ${large ? 'text-base' : 'text-sm'}`}
          />
          <button
            onClick={send}
            disabled={disabled}
            className="m-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:bg-zinc-300"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Attachments ----------

export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`

const extensionOf = (name: string) =>
  name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE'

// Opens an image full size. Only provided where the lightbox exists (variant D).
export const LightboxContext = createContext<((a: Attachment) => void) | null>(
  null
)

// Images as uniform thumbnails, everything else as file chips, in one wrapping row.
export function AttachmentList({
  items,
  onRemove,
  className = '',
}: {
  items: Attachment[]
  onRemove?: (a: Attachment) => void
  className?: string
}) {
  const openImage = useContext(LightboxContext)
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((a, i) => (
        <div key={`${a.url}-${i}`} className="group/att relative">
          {a.type.startsWith('image/') ? (
            <button
              onClick={openImage ? () => openImage(a) : undefined}
              title={a.name}
              className={`nodrag block h-14 w-14 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 ${openImage ? 'cursor-zoom-in' : 'cursor-default'}`}
            >
              <img
                src={a.url}
                alt={a.name}
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <div
              title={a.name}
              className="flex h-14 max-w-[200px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 text-left"
            >
              <span
                className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-bold text-white ${a.type === 'application/pdf' ? 'bg-red-500' : 'bg-zinc-500'}`}
              >
                {extensionOf(a.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs text-zinc-800">
                  {a.name}
                </span>
                <span className="block text-[10px] text-zinc-500">
                  {formatBytes(a.size)}
                </span>
              </span>
            </div>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(a)}
              title={`Remove ${a.name}`}
              aria-label={`Remove ${a.name}`}
              className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[10px] leading-none text-white hover:bg-red-600"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------- Canvas features only variant D turns on ----------

export const CanvasFeatures = createContext({collapse: false, attach: false})

// Replaces the Fork pill: collapses or expands everything below a Reply.
export function FoldToggle({reply}: {reply: Turn}) {
  const sim = useSim()
  const kids = childrenOf(sim.tree, reply.id).length
  if (!kids) return null
  const collapsed = sim.collapsed.includes(reply.id)
  const hidden = subtreeIds(sim.tree, reply.id).length - 1
  const fork = kids >= 2
  const label = collapsed
    ? fork
      ? `▸ ${kids} Branches hidden · ${hidden} Turns`
      : `▸ ${hidden} Turns hidden`
    : fork
      ? `▾ Fork · ${kids} Branches`
      : '▾'
  return (
    <button
      onClick={() => sim.toggleCollapsed(reply.id)}
      title={collapsed ? 'Expand' : 'Collapse everything below'}
      aria-expanded={!collapsed}
      className={`nodrag shrink-0 rounded px-1.5 text-[11px] ${
        fork
          ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
          : collapsed
            ? 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
      }`}
    >
      {label}
    </button>
  )
}

// ---------- Long text: scrolls in place, Show more expands it ----------

export function ScrollableText({
  maxHeightClass,
  streaming = false,
  className = '',
  children,
}: {
  maxHeightClass: string
  streaming?: boolean
  className?: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Stays true until the user scrolls up, so streaming only follows new text while they're at the bottom.
  const pinnedRef = useRef(true)

  // No deps: streamed text grows every render, so re-measure every time.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    setOverflows(el.scrollHeight > el.clientHeight)
    if (streaming && pinnedRef.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div className={className}>
      <div
        ref={ref}
        onScroll={e => {
          const el = e.currentTarget
          pinnedRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className={`whitespace-pre-wrap ${expanded ? '' : `nowheel ${maxHeightClass} overflow-y-auto`}`}
      >
        {children}
      </div>
      {(overflows || expanded) && (
        <div className="mt-1 flex justify-end">
          <button
            onClick={() => setExpanded(e => !e)}
            className="nodrag text-[11px] text-violet-700 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      )}
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

// Hover-revealed overlay on the box's top-right corner, so neither the 🗑 nor its armed state shifts layout.
// Needs a `relative` parent inside a `group`.
export function DeletePill({
  tree,
  promptId,
  onDelete,
}: {
  tree: Tree
  promptId: string
  onDelete: () => void
}) {
  return (
    <div className="absolute -top-2.5 -right-2.5 z-10 hidden rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 whitespace-nowrap shadow-sm group-hover:block">
      <DeleteButton tree={tree} promptId={promptId} onDelete={onDelete} />
    </div>
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

// What the AI carries if you continue from the end of this Thread.
export function ThreadContextSize({thread}: {thread: Turn[]}) {
  return (
    <div className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-500">
      <div className="mb-1 font-medium text-zinc-700">
        Context size: {formatTokens(thread.reduce((s, t) => s + t.tokens, 0))}
      </div>
      <div className="flex h-2 overflow-hidden rounded bg-zinc-100">
        {thread.map(t => (
          <div
            key={t.id}
            title={`${t.kind === 'prompt' ? 'Prompt' : 'Reply'}: ${formatTokens(t.tokens)}`}
            className={`h-full border-r border-white ${t.kind === 'prompt' ? 'bg-sky-300' : 'bg-violet-400'}`}
            style={{flexGrow: t.tokens}}
          />
        ))}
      </div>
    </div>
  )
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
  const spread = spreadReplies(sim.tree, 3)
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
      <div className="mt-1.5 flex items-center gap-1.5">
        Speed
        <div className="flex overflow-hidden rounded border border-fuchsia-400">
          {(['slow', 'normal', 'fast'] as const).map(s => (
            <button
              key={s}
              onClick={() => sim.setSpeed(s)}
              className={`px-1.5 py-0.5 capitalize ${sim.speed === s ? 'bg-fuchsia-700 text-white' : 'hover:bg-fuchsia-100'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => {
          for (const id of spread) sim.submit(id, 'Quick one: anything to add?')
        }}
        disabled={!spread.length}
        className="mt-1.5 block rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Start 3 Replies at once
      </button>
      <div className="mt-1.5 flex gap-1.5">
        <button
          onClick={sim.reset}
          className="rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100"
        >
          Reset Tree
        </button>
        <button
          onClick={sim.clear}
          className="rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100"
        >
          Clear canvas
        </button>
      </div>
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
export const SimContext = createContext<TreeSim | null>(null)
export const useSim = () => useContext(SimContext)!
