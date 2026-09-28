// PROTOTYPE variant C: the canvas is a compact map of chips; long text is read in a side drawer.
// Selecting a Turn highlights its Thread. Throw away.
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {useMemo, useState} from 'react'

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
  threadIds,
  useTreeLayout,
  useSim,
} from './shared'
import {childrenOf, formatTokens, pathTo, type Turn} from './tree'

export const name = 'Compact map + reader drawer'

type Data = {
  turn: Turn
  selected: boolean
  onThread: boolean
  select: (id: string) => void
}

const handles = (
  <>
    <Handle type="target" position={Position.Top} className="!opacity-0" />
    <Handle type="source" position={Position.Bottom} className="!opacity-0" />
  </>
)

function PromptChip({data}: NodeProps<Node<Data>>) {
  const {turn, selected, onThread, select} = data
  return (
    <div
      onClick={() => select(turn.id)}
      className={`w-[200px] cursor-pointer rounded-full border px-3 py-1.5 text-xs text-sky-950 ${selected ? 'border-sky-500 bg-sky-100' : onThread ? 'border-sky-300 bg-sky-50' : 'border-sky-200 bg-sky-50/60 opacity-80'}`}
    >
      {handles}
      <div className="truncate">{turn.text}</div>
    </div>
  )
}

function ReplyChip({data}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {turn, selected, onThread, select} = data
  const [inputFocused, setInputFocused] = useState(false)
  // After sending from a hover Input, keep it hidden until the pointer leaves, so only the newest Reply shows one.
  const [dismissed, setDismissed] = useState(false)
  const streaming = turn.status === 'streaming'
  const isLast = turn.id === sim.lastAnsweredId
  const branches = childrenOf(sim.tree, turn.id).length

  return (
    <div className="group relative w-[240px]" onMouseLeave={() => setDismissed(false)}>
      {handles}
      <div
        onClick={() => select(turn.id)}
        className={`cursor-pointer rounded-lg border bg-white px-2.5 py-1.5 shadow-sm ${
          turn.status === 'failed'
            ? 'border-red-300 bg-red-50'
            : selected
              ? 'border-violet-500 ring-2 ring-violet-200'
              : onThread
                ? 'border-violet-300'
                : 'border-zinc-200'
        } ${!onThread && !selected ? 'opacity-80' : ''}`}
      >
        <div className="line-clamp-2 text-xs text-zinc-700">
          {streaming ? `…${turn.text.slice(-90)}` : turn.text || '…'}
          {streaming && <Cursor />}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-400">
          {turn.status === 'failed' ? (
            <span className="text-red-600">Failed</span>
          ) : (
            <ContextBadge
              tree={sim.tree}
              reply={turn}
              className="!text-[10px]"
            />
          )}
          {turn.status === 'stopped' && <span>Stopped</span>}
          {streaming && <span className="text-violet-600">streaming</span>}
          {branches >= 2 && (
            <span className="text-amber-700">⑂ {branches}</span>
          )}
        </div>
      </div>
      {canRespond(turn) && (
        <div
          className={
            isLast
              ? 'mt-1.5'
              : `absolute inset-x-0 top-full z-10 pt-1.5 ${dismissed ? 'hidden' : inputFocused ? 'block' : 'hidden group-hover:block'}`
          }
        >
          <PromptInput
            compact
            branching={branches > 0}
            onFocusChange={setInputFocused}
            blurOnSend={!isLast}
            onSubmit={t => {
              if (!isLast) setDismissed(true)
              sim.submit(turn.id, t)
            }}
          />
        </div>
      )}
    </div>
  )
}

function Drawer({id, onClose}: {id: string; onClose: () => void}) {
  const sim = useSim()
  const turn = sim.tree[id]
  if (!turn) return null
  const reply = turn.kind === 'reply' ? turn : childrenOf(sim.tree, turn.id)[0]
  const prompt =
    turn.kind === 'prompt'
      ? turn
      : turn.parentId
        ? sim.tree[turn.parentId]
        : undefined
  const thread = pathTo(sim.tree, reply?.id ?? turn.id)

  return (
    <aside className="fixed top-0 right-0 bottom-0 z-40 flex w-[440px] flex-col border-l border-zinc-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
        <span>
          Turn {thread.length} of this Thread · {reply?.model}
        </span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900">
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {prompt && (
          <div className="group mb-3 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950">
            <span className="flex-1 whitespace-pre-wrap">{prompt.text}</span>
            <DeleteButton
              tree={sim.tree}
              promptId={prompt.id}
              onDelete={() => {
                sim.deleteFrom(prompt.id)
                onClose()
              }}
            />
          </div>
        )}
        {reply && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-800">
            {reply.text}
            {reply.status === 'streaming' && <Cursor />}
            <div className="mt-2">
              <StatusBar reply={reply} sim={sim} />
            </div>
          </div>
        )}
      </div>
      {/* Context size breakdown: what the AI carries if you continue from here */}
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
    </aside>
  )
}

const nodeTypes = {prompt: PromptChip, reply: ReplyChip}

export function VariantC() {
  const sim = useSim()
  const [selected, setSelected] = useState<string | null>(null)
  const onThread = useMemo(() => {
    const target =
      selected && sim.tree[selected]?.kind === 'prompt'
        ? (childrenOf(sim.tree, selected)[0]?.id ?? selected)
        : selected
    return threadIds(sim.tree, target)
  }, [sim.tree, selected])

  const {base, edges} = useMemo(() => {
    const turns = Object.values(sim.tree).sort(
      (a, b) => a.createdAt - b.createdAt
    )
    const base: Node<Data>[] = turns.map(t => ({
      id: t.id,
      type: t.kind,
      position: {x: 0, y: 0},
      data: {
        turn: t,
        selected: t.id === selected,
        onThread: onThread.has(t.id),
        select: setSelected,
      },
    }))
    const edges: Edge[] = turns
      .filter(t => t.parentId)
      .map(t => {
        const hot = onThread.has(t.id) && onThread.has(t.parentId!)
        return {
          id: `${t.parentId}-${t.id}`,
          source: t.parentId!,
          target: t.id,
          type: 'smoothstep',
          style: {
            stroke: hot ? '#8b5cf6' : '#d4d4d8',
            strokeWidth: hot ? 2.5 : 1.5,
          },
        }
      })
    return {base, edges}
  }, [sim.tree, selected, onThread])
  const {nodes, onNodesChange} = useTreeLayout(base, edges, 'TB', {
    rank: 26,
    node: 18,
  })

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onPaneClick={() => setSelected(null)}
        {...canvasProps}
      >
        <Background gap={24} color="#d4d4d8" />
        <MiniMap pannable zoomable position="bottom-left" />
        <Controls
          showInteractive={false}
          position="bottom-right"
          style={selected ? {right: 450} : undefined}
        />
        <FitOnceMeasured />
        <FocusOnSubmit focus={sim.focus} />
      </ReactFlow>
      {selected && <Drawer id={selected} onClose={() => setSelected(null)} />}
    </>
  )
}
