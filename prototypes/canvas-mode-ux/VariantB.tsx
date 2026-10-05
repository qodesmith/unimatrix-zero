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
import {useContext, useMemo, useState} from 'react'

import {
  AttachmentList,
  CanvasFeatures,
  canRespond,
  canvasProps,
  ContextBadge,
  Cursor,
  DeletePill,
  edgeStyle,
  FitOnceMeasured,
  FocusOnSubmit,
  FoldToggle,
  PromptInput,
  ScrollableText,
  StatusBar,
  threadIds,
  useHasDraft,
  useHighlight,
  useHighlightTarget,
  useLeafFocus,
  useReportTyping,
  useDecor,
  useTreeLayout,
  useSim,
} from './shared'
import {
  childrenOf,
  contextSize,
  formatTokens,
  type Tree,
  type Turn,
} from './tree'

export const name = 'Exchange cards, left-to-right, scrolling'

// Pretend 10k context window so the meter visibly moves with fake data.
const WINDOW = 10_000

type Data = {prompt: Turn; reply: Turn}

// `selected` and `data-turn` are only used by variant D (drawer selection and click targets).
export function ExchangeNode({data, selected}: NodeProps<Node<Data>>) {
  const sim = useSim()
  const {prompt, reply} = data
  const [inputFocused, setInputFocused] = useState(false)
  // After sending, keep the hover Input hidden until the pointer leaves, so only the newest Reply shows one.
  const [dismissed, setDismissed] = useState(false)
  const streaming = reply.status === 'streaming'
  const branches = childrenOf(sim.tree, reply.id).length
  const isActive = reply.id === sim.activeReplyId
  const ctx = contextSize(sim.tree, reply.id)
  const reportTyping = useReportTyping(reply.id)
  const leafFocus = useLeafFocus(reply.id)
  const features = useContext(CanvasFeatures)
  const hasDraft = useHasDraft(reply.id)
  const decor = useDecor()

  return (
    <div
      className="group relative flex items-start gap-2"
      data-draft={hasDraft || undefined}
      onMouseLeave={() => setDismissed(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!top-6 !opacity-0"
      />
      <div className="relative w-[440px]">
        <div
          data-turn={reply.id}
          className={`overflow-hidden rounded-xl border bg-white shadow-sm ${selected ? 'border-violet-400 ring-2 ring-violet-500 ring-offset-2' : reply.status === 'failed' ? 'border-red-300' : streaming ? 'border-violet-300 ring-2 ring-violet-100' : 'border-zinc-200'}`}
        >
          {/* Prompt as the card's header */}
          <div
            data-turn={prompt.id}
            className="flex items-start gap-2 border-b border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-950"
          >
            <span className="mt-0.5 text-[10px] font-semibold text-sky-500 uppercase">
              You
            </span>
            <div className="min-w-0 flex-1">
              {prompt.attachments && (
                <AttachmentList
                  items={prompt.attachments}
                  className={prompt.text ? 'mb-2' : ''}
                />
              )}
              {prompt.text && (
                <ScrollableText maxHeightClass="max-h-32">
                  {prompt.text}
                </ScrollableText>
              )}
              {decor.prompt?.(prompt)}
            </div>
            {features.collapse ? (
              <FoldToggle reply={reply} />
            ) : (
              branches >= 2 && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">
                  Fork · {branches} Branches
                </span>
              )
            )}
          </div>

          {decor.replyTop?.(reply, 'canvas')}
          <ScrollableText
            maxHeightClass="max-h-72"
            streaming={streaming}
            className={`px-3 py-2 text-sm leading-relaxed ${reply.status === 'failed' ? 'text-zinc-400' : 'text-zinc-800'}`}
          >
            {decor.replyBody?.(reply, 'canvas') ?? reply.text}
            {streaming && <Cursor />}
          </ScrollableText>
          {decor.replyBottom?.(reply, 'canvas')}

          <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500">
            <span>{reply.model}</span>
            <StatusBar reply={reply} sim={sim} />
            {decor.replyFooter?.(reply, 'canvas')}
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
        <DeletePill
          tree={sim.tree}
          promptId={prompt.id}
          onDelete={() => sim.deleteFrom(prompt.id)}
        />
        {decor.replyOverlay?.(reply)}
      </div>

      {/* Input docks to the right edge, where the next exchange will appear. The column is always reserved so hover doesn't shift the layout. */}
      {canRespond(reply) && (
        <div className="w-[280px] pt-1">
          <div
            className={
              isActive
                ? ''
                : dismissed
                  ? 'hidden'
                  : inputFocused || hasDraft
                    ? 'block'
                    : 'hidden group-hover:block'
            }
          >
            <PromptInput
              draftId={reply.id}
              branching={branches > 0}
              attachable={features.attach}
              onFocusChange={f => {
                setInputFocused(f)
                if (branches === 0) leafFocus(f)
              }}
              onTypingChange={branches === 0 ? undefined : reportTyping}
              blurOnSend
              onSubmit={(t, a) => {
                setDismissed(true)
                sim.submit(reply.id, t, a)
              }}
            />
          </div>
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

// One card per exchange, keyed by Prompt id.
export function exchangeGraph(tree: Tree) {
  const replies = Object.values(tree)
    .filter(t => t.kind === 'reply')
    .sort((a, b) => a.createdAt - b.createdAt)
  const base: Node<Data>[] = replies.map(r => ({
    id: r.parentId!,
    type: 'exchange',
    position: {x: 0, y: 0},
    data: {prompt: tree[r.parentId!]!, reply: r},
  }))
  const edges: Edge[] = base
    .filter(n => n.data.prompt.parentId)
    .map(n => {
      const parentPrompt = tree[n.data.prompt.parentId!]!.parentId!
      return {
        id: `${parentPrompt}-${n.id}`,
        source: parentPrompt,
        target: n.id,
        type: 'smoothstep',
      }
    })
  return {base, edges}
}

export function VariantB() {
  const sim = useSim()
  const {base, edges} = useMemo(() => exchangeGraph(sim.tree), [sim.tree])
  const {nodes, onNodesChange} = useTreeLayout(base, edges, 'LR', {
    rank: 30,
    node: 28,
  })
  const {setHoverId} = useHighlight()
  const target = useHighlightTarget()
  // Exchange nodes are keyed by Prompt id, and every Prompt is on its Reply's Thread.
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
      onNodeMouseEnter={(_, n) => setHoverId((n.data as Data).reply.id)}
      onNodeMouseLeave={() => setHoverId(null)}
    >
      <Background gap={24} color="#d4d4d8" />
      <MiniMap pannable zoomable position="bottom-left" />
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
