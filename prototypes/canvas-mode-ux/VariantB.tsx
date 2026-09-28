// PROTOTYPE variant B: one card per exchange (Prompt + its Reply), reading left to right, Forks fan vertically.
// Long Replies scroll inside a fixed-height card. Throw away.
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
  useTreeLayout,
  useSim,
} from './shared'
import {childrenOf, contextSize, formatTokens, type Turn} from './tree'

export const name = 'Exchange cards, left-to-right, scrolling'

// Pretend 10k context window so the meter visibly moves with fake data.
const WINDOW = 10_000

type Data = {prompt: Turn; reply: Turn}

function ExchangeNode({data}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {prompt, reply} = data
  const [inputOpen, setInputOpen] = useState(false)
  const streaming = reply.status === 'streaming'
  const branches = childrenOf(sim.tree, reply.id).length
  const isLast = reply.id === sim.lastAnsweredId
  const ctx = contextSize(sim.tree, reply.id)
  const showInput = canRespond(reply) && (isLast || inputOpen)

  return (
    <div
      className="group relative flex items-start gap-2"
      onMouseLeave={() => !isLast && setInputOpen(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!top-6 !opacity-0"
      />
      <div
        className={`w-[400px] overflow-hidden rounded-xl border bg-white shadow-sm ${reply.status === 'failed' ? 'border-red-300' : streaming ? 'border-violet-300 ring-2 ring-violet-100' : 'border-zinc-200'}`}
      >
        {/* Prompt as the card's header */}
        <div className="flex items-start gap-2 border-b border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          <span className="mt-0.5 text-[10px] font-semibold text-sky-500 uppercase">
            You
          </span>
          <span className="line-clamp-3 flex-1 whitespace-pre-wrap">
            {prompt.text}
          </span>
          <span className="hidden group-hover:inline">
            <DeleteButton
              tree={sim.tree}
              promptId={prompt.id}
              onDelete={() => sim.deleteFrom(prompt.id)}
            />
          </span>
        </div>

        {/* Reply body scrolls inside the card; nowheel stops the canvas from panning while you read. */}
        <div className="nowheel max-h-72 overflow-y-auto px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-zinc-800">
          <span className={reply.status === 'failed' ? 'text-zinc-400' : ''}>
            {reply.text}
          </span>
          {streaming && <Cursor />}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500">
          <span>{reply.model}</span>
          <StatusBar reply={reply} sim={sim} />
          <span className="flex-1" />
          {reply.status !== 'failed' && (
            <ContextBadge tree={sim.tree} reply={reply} />
          )}
        </div>
        {/* Context size as a meter across the bottom edge */}
        <div
          className="h-1 bg-zinc-100"
          title={`${formatTokens(ctx)} of ${formatTokens(WINDOW)}`}
        >
          <div
            className="h-full bg-violet-400"
            style={{width: `${Math.min(100, (ctx / WINDOW) * 100)}%`}}
          />
        </div>
      </div>

      {/* Input docks to the right edge, where the next exchange will appear */}
      {canRespond(reply) && (
        <div className="w-[280px] pt-1">
          {showInput ? (
            <PromptInput
              branching={branches > 0}
              autoFocus={!isLast}
              onSubmit={t => {
                setInputOpen(false)
                sim.submit(reply.id, t)
              }}
            />
          ) : (
            <button
              onClick={() => setInputOpen(true)}
              className="nodrag hidden rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600 shadow-sm group-hover:inline-block hover:bg-zinc-50"
            >
              {branches > 0 ? '+ Branch' : '+ Reply'}
            </button>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!top-6 !right-[288px] !opacity-0"
      />
    </div>
  )
}

const nodeTypes = {exchange: ExchangeNode}

export function VariantB() {
  const sim = useSim()
  const {base, edges} = useMemo(() => {
    const replies = Object.values(sim.tree)
      .filter(t => t.kind === 'reply')
      .sort((a, b) => a.createdAt - b.createdAt)
    const base: Node<Data>[] = replies.map(r => ({
      id: r.parentId!,
      type: 'exchange',
      position: {x: 0, y: 0},
      data: {prompt: sim.tree[r.parentId!]!, reply: r},
    }))
    const edges: Edge[] = base
      .filter(n => n.data.prompt.parentId)
      .map(n => {
        const parentPrompt = sim.tree[n.data.prompt.parentId!]!.parentId!
        return {
          id: `${parentPrompt}-${n.id}`,
          source: parentPrompt,
          target: n.id,
          type: 'smoothstep',
          style: {stroke: '#a1a1aa'},
        }
      })
    return {base, edges}
  }, [sim.tree])
  const {nodes, onNodesChange} = useTreeLayout(base, edges, 'LR', {
    rank: 30,
    node: 28,
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
      <MiniMap pannable zoomable position="top-right" />
      <Controls showInteractive={false} position="bottom-right" />
      <FitOnceMeasured />
      <FocusOnSubmit
        focus={
          sim.focus && {
            ...sim.focus,
            id: sim.tree[sim.focus.id]?.parentId ?? '',
          }
        }
      />
    </ReactFlow>
  )
}
