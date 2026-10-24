import type {LayoutNode} from '../layout'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {Node, NodeProps} from '@xyflow/react'

import {cn} from '#modules/shadcn/main'
import {ReplyView, useLiveReply} from '#modules/turns/main'
import {Handle, Position} from '@xyflow/react'
import {useState} from 'react'

import {useCanvas} from '../canvas-context'
import {TURN_WIDTH} from '../layout'
import {branchesOf, isFork, previousReply} from '../tree'
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
      {isFork(index, reply.id) && (
        <ForkPill
          replyId={reply.id}
          branches={branchesOf(index, reply.id).length}
        />
      )}
      {contextSizeMeter && contextSize !== null && contextWindow !== null && (
        <ContextMeter contextSize={contextSize} contextWindow={contextWindow} />
      )}
    </>
  )
}

/** A Fork's pill, folding its Branches away and bringing them back. */
function ForkPill({replyId, branches}: {replyId: string; branches: number}) {
  const {collapsedReplyIds, toggleCollapsed} = useCanvas()
  const collapsed = collapsedReplyIds.has(replyId)

  return (
    <footer className="px-3.5 pb-2.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        className={cn(
          'rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground',
          'hover:text-foreground'
        )}
        onClick={() => toggleCollapsed(replyId)}
      >
        Fork · {branches} Branches
      </button>
    </footer>
  )
}

/**
 * The Input answering a Reply, mounted once the Reply is done with its space
 * kept, so revealing it shifts nothing. Revealed at the end of the Active
 * Thread, while the Reply's box is hovered or holds focus, and while it holds
 * a draft.
 */
function ReplyInput({reply, hovered}: {reply: Reply; hovered: boolean}) {
  const {treeId, activeReplyId, setActiveReplyId, onSent, drafts, setDraft} =
    useCanvas()

  const status = useLiveReply(reply.id)?.status ?? reply.status

  if (status === 'streaming') return null

  const draft = drafts.get(reply.id) ?? ''
  const revealed = activeReplyId === reply.id || draft.trim() !== '' || hovered

  return (
    <div
      data-revealed={revealed}
      className={cn(
        'mt-2 transition-opacity',
        !revealed && 'opacity-0 focus-within:opacity-100'
      )}
    >
      <PromptInput
        treeId={treeId}
        parentReplyId={reply.id}
        onFocus={() => setActiveReplyId(reply.id)}
        onSent={replyId => onSent(replyId, reply.id)}
        draft={draft}
        onDraftChange={text => setDraft(reply.id, text)}
      />
    </div>
  )
}

/** The pointer being over a Reply's box, for revealing its Input. */
function useHovered() {
  const [hovered, setHovered] = useState(false)

  return {
    hovered,
    hoverProps: {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
  }
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

/** Vertical: a Reply on its own, with its Input once it is done. */
export function ReplyNode({data}: NodeProps<TurnNode>) {
  const {turn} = data
  const {hovered, hoverProps} = useHovered()

  if (turn.kind !== 'reply') return null

  return (
    <div style={{width: TURN_WIDTH}} {...hoverProps}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <ReplyTurn reply={turn.reply} />
      <ReplyInput reply={turn.reply} hovered={hovered} />
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
  const {hovered, hoverProps} = useHovered()

  if (turn.kind !== 'exchange') return null

  return (
    <div style={{width: TURN_WIDTH}} {...hoverProps}>
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <ExchangeTurns prompt={turn.prompt} reply={turn.reply} />
      {turn.reply && <ReplyInput reply={turn.reply} hovered={hovered} />}
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
