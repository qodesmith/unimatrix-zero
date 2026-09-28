// PROTOTYPE variant A: every Turn is its own box, Tree grows top-down, long Replies scroll. Throw away.
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {useEffect, useMemo, useRef, useState} from 'react'

import {
  canRespond,
  canvasProps,
  ContextBadge,
  Cursor,
  DeleteButton,
  FitOnceMeasured,
  FocusOnSubmit,
  PromptInput,
  StatusBar,
  useTreeLayout,
  useSim,
} from './shared'
import {childrenOf, type Turn} from './tree'

export const name = 'Turn boxes, top-down, collapsible'

type Data = {turn: Turn}

const handles = (
  <>
    <Handle type="target" position={Position.Top} className="!opacity-0" />
    <Handle type="source" position={Position.Bottom} className="!opacity-0" />
  </>
)

function PromptNode({data}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {turn} = data
  return (
    <div className="group relative w-[440px] rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-950 shadow-sm">
      {handles}
      <div className="nowheel max-h-32 overflow-y-auto whitespace-pre-wrap">
        {turn.text}
      </div>
      <div className="absolute -top-2.5 -right-2.5 hidden rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 shadow-sm group-hover:block">
        <DeleteButton
          tree={sim.tree}
          promptId={turn.id}
          onDelete={() => sim.deleteFrom(turn.id)}
        />
      </div>
    </div>
  )
}

const LONG_CHARS = 420

function ReplyNode({data}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {turn} = data
  const [expanded, setExpanded] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  // After sending, keep the hover Input hidden until the pointer leaves, so only the newest Reply shows one.
  const [dismissed, setDismissed] = useState(false)
  const long = turn.text.length > LONG_CHARS
  const streaming = turn.status === 'streaming'
  const isActive = turn.id === sim.activeReplyId
  const branches = childrenOf(sim.tree, turn.id).length
  const collapsed = long && !expanded
  const bodyRef = useRef<HTMLDivElement>(null)
  // Stays true until the user scrolls up, so streaming only follows new text while they're at the bottom.
  const pinnedRef = useRef(true)

  useEffect(() => {
    const el = bodyRef.current
    if (el && collapsed && streaming && pinnedRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [turn.text, collapsed, streaming])

  return (
    <div
      className="group relative w-[440px]"
      onMouseLeave={() => setDismissed(false)}
    >
      {handles}
      <div
        className={`rounded-xl border bg-white shadow-sm ${turn.status === 'failed' ? 'border-red-300' : streaming ? 'border-violet-300 ring-2 ring-violet-100' : 'border-zinc-200'}`}
      >
        <div className="flex items-center justify-between px-3.5 pt-2.5 text-[11px] text-zinc-500">
          <span>{turn.model}</span>
          {branches >= 2 && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-800">
              Fork · {branches} Branches
            </span>
          )}
        </div>
        <div
          ref={bodyRef}
          onScroll={e => {
            const el = e.currentTarget
            pinnedRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className={`px-3.5 py-2 text-sm leading-relaxed text-zinc-800 ${collapsed ? 'nowheel max-h-72 overflow-y-auto' : ''}`}
        >
          <div
            className={`whitespace-pre-wrap ${turn.status === 'failed' ? 'text-zinc-400' : ''}`}
          >
            {turn.text}
            {streaming && <Cursor />}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-100 px-3.5 py-1.5">
          {turn.status !== 'failed' && (
            <ContextBadge tree={sim.tree} reply={turn} />
          )}
          <StatusBar reply={turn} sim={sim} />
          <span className="flex-1" />
          {long && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="nodrag text-[11px] text-violet-700 hover:underline"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>

      {/* Input: always shown on the active Reply; hover-revealed as an overlay elsewhere so the layout doesn't jump. */}
      {canRespond(turn) &&
        (isActive ? (
          <div className="mt-2">
            <PromptInput
              branching={branches > 0}
              onSubmit={t => {
                setDismissed(true)
                sim.submit(turn.id, t)
              }}
            />
          </div>
        ) : (
          <div
            className={`absolute inset-x-0 top-full z-10 pt-2 ${dismissed ? 'hidden' : inputFocused ? 'block' : 'hidden group-hover:block'}`}
          >
            <PromptInput
              branching={branches > 0}
              onFocusChange={setInputFocused}
              blurOnSend
              onSubmit={t => {
                setDismissed(true)
                sim.submit(turn.id, t)
              }}
            />
          </div>
        ))}
    </div>
  )
}

const nodeTypes = {prompt: PromptNode, reply: ReplyNode}

export function VariantA() {
  const sim = useSim()
  const {base, edges} = useMemo(() => {
    const turns = Object.values(sim.tree).sort(
      (a, b) => a.createdAt - b.createdAt
    )
    const base: Node<Data>[] = turns.map(t => ({
      id: t.id,
      type: t.kind,
      position: {x: 0, y: 0},
      data: {turn: t},
    }))
    const edges: Edge[] = turns
      .filter(t => t.parentId)
      .map(t => ({
        id: `${t.parentId}-${t.id}`,
        source: t.parentId!,
        target: t.id,
        type: 'smoothstep',
        style: {stroke: '#a1a1aa'},
      }))
    return {base, edges}
  }, [sim.tree])
  const {nodes, onNodesChange} = useTreeLayout(base, edges, 'TB', {
    rank: 40,
    node: 36,
  })

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      {...canvasProps}
    >
      <Background gap={24} color="#d4d4d8" />
      <Controls showInteractive={false} position="bottom-right" />
      <FitOnceMeasured />
      <FocusOnSubmit focus={sim.focus} />
    </ReactFlow>
  )
}
