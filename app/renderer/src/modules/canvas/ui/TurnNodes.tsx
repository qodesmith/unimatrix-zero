import type {LayoutNode} from '../layout'
import type {Reply} from '@uz/contract/turns'
import type {Node, NodeProps} from '@xyflow/react'

import {cn} from '#modules/shadcn/main'
import {ReplyView, useLiveReply} from '#modules/turns/main'
import {Handle, Position} from '@xyflow/react'

import {useCanvas} from '../canvas-context'
import {isLeaf, previousReply} from '../tree'
import {CappedText} from './CappedText'
import {ContextMeter, ContextSizeBadge} from './ContextSize'
import {PromptInput} from './PromptInput'

/** Every box on the canvas is one of these, typed by the Turn it shows. */
export type TurnNode = Node<{turn: LayoutNode}, LayoutNode['kind']>

const hiddenHandle = 'opacity-0!'

function PromptText({text}: {text: string}) {
  const {limitMessageHeight} = useCanvas()

  return (
    <CappedText limit={limitMessageHeight} maxHeightClass="max-h-32">
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </CappedText>
  )
}

/** The Reply's content with its Context size, live while it streams. */
function ReplyBody({reply}: {reply: Reply}) {
  const {index, limitMessageHeight, contextSizeMeter} = useCanvas()
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
            previousContextSize={previous?.contextSize ?? null}
          />
        </header>
      )}
      <CappedText
        limit={limitMessageHeight}
        maxHeightClass="max-h-72"
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

export function PromptNode({data}: NodeProps<TurnNode>) {
  const {turn} = data

  if (turn.kind !== 'prompt') return null

  return (
    <div className="w-[440px]">
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div
        data-turn={turn.prompt.id}
        className="rounded-xl border border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground shadow-sm"
      >
        <PromptText text={turn.prompt.text} />
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  )
}

export function ReplyNode({data}: NodeProps<TurnNode>) {
  const {turn} = data
  const live = useLiveReply(turn.kind === 'reply' ? turn.reply.id : '')

  if (turn.kind !== 'reply') return null

  const {reply} = turn

  return (
    <div className="w-[440px]">
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div
        data-turn={reply.id}
        className={replyFrame(live?.status ?? reply.status)}
      >
        <ReplyBody reply={reply} />
      </div>
      <LeafInput reply={reply} />
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  )
}

/** Horizontal: the Prompt as the card's header and its Reply as the body. */
export function ExchangeNode({data}: NodeProps<TurnNode>) {
  const {turn} = data
  const reply = turn.kind === 'exchange' ? turn.reply : null
  const live = useLiveReply(reply?.id ?? '')

  if (turn.kind !== 'exchange') return null

  return (
    <div className="w-[440px]">
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <div
        className={cn(
          'overflow-hidden',
          replyFrame(live?.status ?? reply?.status ?? 'complete')
        )}
      >
        <div
          data-turn={turn.prompt.id}
          className="border-b border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground"
        >
          <PromptText text={turn.prompt.text} />
        </div>
        {reply && (
          <div data-turn={reply.id}>
            <ReplyBody reply={reply} />
          </div>
        )}
      </div>
      {reply && <LeafInput reply={reply} />}
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  )
}
