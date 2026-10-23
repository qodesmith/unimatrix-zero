import type {LayoutNode} from '../layout'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {Node, NodeProps} from '@xyflow/react'

import {cn} from '#modules/shadcn/main'
import {ReplyView, useLiveReply} from '#modules/turns/main'
import {Handle, Position} from '@xyflow/react'

import {useCanvas} from '../canvas-context'
import {TURN_WIDTH} from '../layout'
import {isLeaf, previousReply} from '../tree'
import {CappedText} from './CappedText'
import {ContextMeter, ContextSizeBadge} from './ContextSize'
import {PromptInput} from './PromptInput'

/** Every box on the canvas is one of these, typed by the Turn it shows. */
export type TurnNode = Node<{turn: LayoutNode}, LayoutNode['kind']>

const hiddenHandle = 'opacity-0!'

function PromptText({prompt}: {prompt: Prompt}) {
  const {limitTurnHeight, expandedTurnIds, toggleExpanded} = useCanvas()

  return (
    <CappedText
      limit={limitTurnHeight}
      maxHeightClass="max-h-32"
      expanded={expandedTurnIds.has(prompt.id)}
      onToggle={() => toggleExpanded(prompt.id)}
    >
      <p className="text-sm whitespace-pre-wrap">{prompt.text}</p>
    </CappedText>
  )
}

/** The Reply's content with its Context size, live while it streams. */
function ReplyBody({reply}: {reply: Reply}) {
  const {
    index,
    limitTurnHeight,
    contextSizeMeter,
    expandedTurnIds,
    toggleExpanded,
  } = useCanvas()

  const live = useLiveReply(reply.id)
  const status = live?.status ?? reply.status
  const contextSize = live?.contextSize ?? reply.contextSize
  const contextWindow = live?.contextWindow ?? reply.contextWindow
  const previous = previousReply(index, reply)

  return (
    <>
      {contextSize !== null && (
        <header className="flex justify-end px-3.5 pt-2">
          <ContextSizeBadge
            contextSize={contextSize}
            previousContextSize={previous ? previous.contextSize : 0}
          />
        </header>
      )}
      <CappedText
        limit={limitTurnHeight}
        maxHeightClass="max-h-72"
        expanded={expandedTurnIds.has(reply.id)}
        onToggle={() => toggleExpanded(reply.id)}
        streaming={status === 'streaming'}
        className="px-3.5 py-2"
      >
        <ReplyView reply={reply} />
      </CappedText>
      {contextSizeMeter && contextSize !== null && contextWindow !== null && (
        <ContextMeter contextSize={contextSize} contextWindow={contextWindow} />
      )}
    </>
  )
}

/** The Input continuing a Thread from its leaf Reply, once that Reply is done. */
function LeafInput({reply}: {reply: Reply}) {
  const {treeId, index, setActiveReplyId, setTypingReplyId, onSent} =
    useCanvas()

  const status = useLiveReply(reply.id)?.status ?? reply.status

  if (!isLeaf(index, reply.id) || status === 'streaming') return null

  return (
    <div className="mt-2">
      <PromptInput
        treeId={treeId}
        parentReplyId={reply.id}
        onFocus={() => setActiveReplyId(reply.id)}
        onTypingChange={typing =>
          setTypingReplyId(current =>
            typing ? reply.id : current === reply.id ? null : current
          )
        }
        onSent={onSent}
      />
    </div>
  )
}

function replyFrame(status: Reply['status']) {
  return cn(
    'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
    status === 'failed' && 'border-destructive',
    status === 'streaming' && 'border-primary/50'
  )
}

/** Vertical: a Prompt on its own, the same width as a Reply. */
export function PromptNode({data}: NodeProps<TurnNode>) {
  const {turn} = data

  if (turn.kind !== 'prompt') return null

  return (
    <div style={{width: TURN_WIDTH}}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div
        data-turn={turn.prompt.id}
        className="rounded-xl border border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground shadow-sm"
      >
        <PromptText prompt={turn.prompt} />
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  )
}

/** Vertical: a Reply on its own, with its Thread's Input once it is done. */
export function ReplyNode({data}: NodeProps<TurnNode>) {
  const {turn} = data

  if (turn.kind !== 'reply') return null

  return (
    <div style={{width: TURN_WIDTH}}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <ReplyTurn reply={turn.reply} />
      <LeafInput reply={turn.reply} />
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  )
}

function ReplyTurn({reply}: {reply: Reply}) {
  const status = useLiveReply(reply.id)?.status ?? reply.status

  return (
    <div data-turn={reply.id} className={replyFrame(status)}>
      <ReplyBody reply={reply} />
    </div>
  )
}

/** Horizontal: the Prompt as the card's header and its Reply as the body. */
export function ExchangeNode({data}: NodeProps<TurnNode>) {
  const {turn} = data

  if (turn.kind !== 'exchange') return null

  return (
    <div style={{width: TURN_WIDTH}}>
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <ExchangeTurns prompt={turn.prompt} reply={turn.reply} />
      {turn.reply && <LeafInput reply={turn.reply} />}
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  )
}

function ExchangeTurns({prompt, reply}: {prompt: Prompt; reply: Reply | null}) {
  const live = useLiveReply(reply?.id ?? null)
  const status = live?.status ?? reply?.status ?? 'complete'

  return (
    <div className={cn('overflow-hidden', replyFrame(status))}>
      <div
        data-turn={prompt.id}
        className="border-b border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground"
      >
        <PromptText prompt={prompt} />
      </div>
      {reply && (
        <div data-turn={reply.id}>
          <ReplyBody reply={reply} />
        </div>
      )}
    </div>
  )
}
