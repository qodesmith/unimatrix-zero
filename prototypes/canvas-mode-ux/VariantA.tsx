// PROTOTYPE variant A: every Turn is its own box, Tree grows top-down, long Replies scroll. Throw away.
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
  DeletePill,
  edgeStyle,
  FitOnceMeasured,
  FocusOnSubmit,
  PromptInput,
  ScrollableText,
  StatusBar,
  threadIds,
  useHighlight,
  useHighlightTarget,
  useReportTyping,
  useTreeLayout,
  useSim,
} from './shared'
import {childrenOf, type Tree, type Turn} from './tree'

export const name = 'Turn boxes, top-down, collapsible'

type Data = {turn: Turn}

const handles = (
  <>
    <Handle type="target" position={Position.Top} className="!opacity-0" />
    <Handle type="source" position={Position.Bottom} className="!opacity-0" />
  </>
)

// `selected` and `data-turn` are only used by variant D (drawer selection and click targets).
export function PromptNode({data, selected}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {turn} = data

  return (
    <div
      data-turn={turn.id}
      className={`group relative w-[440px] rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm text-sky-950 shadow-sm ${selected ? 'ring-2 ring-sky-500 ring-offset-2' : ''}`}
    >
      {handles}
      <ScrollableText maxHeightClass="max-h-32">{turn.text}</ScrollableText>
      <DeletePill
        tree={sim.tree}
        promptId={turn.id}
        onDelete={() => sim.deleteFrom(turn.id)}
      />
    </div>
  )
}

export function ReplyNode({data, selected}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {turn} = data
  const [inputFocused, setInputFocused] = useState(false)
  // After sending, keep the hover Input hidden until the pointer leaves, so only the newest Reply shows one.
  const [dismissed, setDismissed] = useState(false)
  const streaming = turn.status === 'streaming'
  const isActive = turn.id === sim.activeReplyId
  const branches = childrenOf(sim.tree, turn.id).length
  const reportTyping = useReportTyping(turn.id)

  return (
    <div
      className="group relative w-[440px]"
      onMouseLeave={() => setDismissed(false)}
    >
      {handles}
      <div
        data-turn={turn.id}
        className={`rounded-xl border bg-white shadow-sm ${selected ? 'border-violet-400 ring-2 ring-violet-500 ring-offset-2' : turn.status === 'failed' ? 'border-red-300' : streaming ? 'border-violet-300 ring-2 ring-violet-100' : 'border-zinc-200'}`}
      >
        <div className="flex items-center justify-between px-3.5 pt-2.5 text-[11px] text-zinc-500">
          <span>{turn.model}</span>
          {branches >= 2 && (
            <span className="rounded bg-amber-100 px-1.5 text-amber-800">
              Fork · {branches} Branches
            </span>
          )}
        </div>
        <ScrollableText
          maxHeightClass="max-h-72"
          streaming={streaming}
          className={`px-3.5 py-2 text-sm leading-relaxed ${turn.status === 'failed' ? 'text-zinc-400' : 'text-zinc-800'}`}
        >
          {turn.text}
          {streaming && <Cursor />}
        </ScrollableText>
        <div className="flex items-center gap-2 border-t border-zinc-100 px-3.5 py-1.5">
          {turn.status !== 'failed' && (
            <ContextBadge tree={sim.tree} reply={turn} />
          )}
          <StatusBar reply={turn} sim={sim} />
        </div>
      </div>

      {/* Input: always shown on the active Reply; hover-revealed as an overlay elsewhere so the layout doesn't jump. */}
      {canRespond(turn) &&
        (isActive ? (
          <div className="mt-2">
            <PromptInput
              branching={branches > 0}
              onTypingChange={reportTyping}
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
              onTypingChange={reportTyping}
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

// One node per Turn, keyed by Turn id.
export function turnGraph(tree: Tree) {
  const turns = Object.values(tree).sort((a, b) => a.createdAt - b.createdAt)
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
    }))
  return {base, edges}
}

export function VariantA() {
  const sim = useSim()
  const {base, edges} = useMemo(() => turnGraph(sim.tree), [sim.tree])
  const {nodes, onNodesChange} = useTreeLayout(base, edges, 'TB', {
    rank: 40,
    node: 36,
  })
  const {setHoverId} = useHighlight()
  const target = useHighlightTarget()
  const styledEdges = useMemo(() => {
    const thread = threadIds(sim.tree, target)
    return edges.map(e => ({
      ...e,
      ...edgeStyle(thread.has(e.source) && thread.has(e.target)),
    }))
  }, [edges, sim.tree, target])

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      {...canvasProps}
      onNodeMouseEnter={(_, n) => setHoverId(n.id)}
      onNodeMouseLeave={() => setHoverId(null)}
    >
      <Background gap={24} color="#d4d4d8" />
      <MiniMap pannable zoomable position="bottom-left" />
      <Controls showInteractive={false} position="bottom-right" />
      <FitOnceMeasured />
      <FocusOnSubmit focus={sim.focus} />
    </ReactFlow>
  )
}
