import type {LayoutNode} from '../layout'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {Node, NodeProps} from '@xyflow/react'

import {Button, cn} from '#modules/shadcn/main'
import {ReplyView, useReply} from '#modules/turns/main'
import {Handle, Position} from '@xyflow/react'
import {useEffect, useRef, useState} from 'react'

import {useCanvas} from '../canvas-context'
import {TURN_WIDTH} from '../layout'
import {branchesOf, isFork, previousReply} from '../tree'
import {CappedText} from './CappedText'
import {ContextMeter, ContextSize} from './ContextSize'
import {PromptBox} from './PromptBox'
import {PromptInput} from './PromptInput'

/** A vertical Reply's line down through its Input's space, drawn as its edge. */
export type Stem = 'none' | 'plain' | 'on-thread'

export type TurnNode = Node<{turn: LayoutNode; stem: Stem}, LayoutNode['kind']>

/** Sized to nothing, so an edge meets the box's border. */
const hiddenHandle = 'size-0! min-h-0! min-w-0! border-0! opacity-0!'

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

function ReplyBody({reply}: {reply: Reply}) {
  const {
    index,
    limitTurnHeight,
    contextSizeMeter,
    expandedTurnIds,
    toggleExpanded,
  } = useCanvas()

  const {status, contextSize, contextWindow} = useReply(reply)
  const previous = previousReply(index, reply)

  return (
    <>
      <header className="flex items-center gap-1 pt-2 pr-2 pl-3.5">
        {contextSize !== null && (
          <ContextSize
            contextSize={contextSize}
            previousContextSize={previous ? previous.contextSize : 0}
            contextWindow={contextWindow}
          />
        )}
        <OpenChatButton replyId={reply.id} />
      </header>
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

function OpenChatButton({replyId}: {replyId: string}) {
  const {openChat} = useCanvas()

  return (
    <Button
      variant="ghost"
      size="icon"
      title="Open in Chat mode"
      aria-label="Open in Chat mode"
      className="ml-auto size-6 text-muted-foreground"
      onClick={() => openChat(replyId)}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Button>
  )
}

function ForkPill({replyId, branches}: {replyId: string; branches: number}) {
  const {collapsedReplyIds, toggleCollapsed} = useCanvas()
  const collapsed = collapsedReplyIds.has(replyId)

  return (
    <footer className="px-3.5 pb-2.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        className={cn(
          'rounded-full border border-border bg-muted px-2.5 py-0.5 text-[0.6875rem] text-muted-foreground',
          'hover:text-foreground'
        )}
        onClick={() => toggleCollapsed(replyId)}
      >
        Fork · {branches} Branches
      </button>
    </footer>
  )
}

type InputState = 'none' | 'hidden' | 'revealed'

/**
 * A failed Reply has no Input, Retry instead; any other shows it for the
 * Active Thread, a draft or the pointer over the node.
 */
function useInputState(reply: Reply | null, hovered: boolean): InputState {
  const {activeReplyId, drafts} = useCanvas()
  const live = useReply(reply)

  if (!live || live.status === 'failed') return 'none'

  const draft = drafts.get(live.id) ?? ''

  return activeReplyId === live.id || draft.trim() !== '' || hovered
    ? 'revealed'
    : 'hidden'
}

/**
 * Slid up behind the box above, not unmounted, so revealing it shifts
 * nothing. It starts a corner's radius up inside the box, padded to match, so
 * it fills the corners as they square; the clip is open below for the shadow.
 */
function ReplyInput({
  reply,
  revealed,
  stem = 'none',
}: {
  reply: Reply
  revealed: boolean
  stem?: Stem
}) {
  const {treeId, inputToFocus, onInputFocus, onSent, drafts, setDraft} =
    useCanvas()

  const {id: replyId, status} = useReply(reply)
  const streaming = status === 'streaming'
  const textarea = useRef<HTMLTextAreaElement>(null)

  // On every render, since the node stays hidden until React Flow measures it.
  useEffect(() => {
    if (inputToFocus === replyId) textarea.current?.focus({preventScroll: true})
  })

  return (
    <div className="relative flow-root">
      {stem !== 'none' && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-opacity',
            stem === 'on-thread'
              ? 'w-[2.5px] bg-thread-highlight'
              : 'w-[1.5px] bg-canvas-edge',
            revealed && 'opacity-0'
          )}
        />
      )}
      <div className="-mt-3 [clip-path:inset(0_-0.5rem_-0.5rem)]">
        <div
          data-revealed={revealed}
          className={cn(
            'rounded-b-xl border border-t-0 border-border bg-card px-3.5 pt-5.5 pb-2.5 shadow-sm transition-[translate] ease-out motion-reduce:transition-none',
            streaming && 'border-primary/50',
            !revealed && '-translate-y-full focus-within:translate-y-0'
          )}
        >
          <PromptInput
            ref={textarea}
            treeId={treeId}
            parentReplyId={replyId}
            canSend={!streaming}
            onFocus={() => onInputFocus(replyId)}
            onSent={sent => onSent(sent, replyId)}
            draft={drafts.get(replyId) ?? ''}
            onDraftChange={text => setDraft(replyId, text)}
          />
        </div>
      </div>
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

/**
 * `joined` squares the bottom corners and fades the bottom border, so the box
 * runs on into the revealed Input under it.
 */
function replyFrame(status: Reply['status'], joined: boolean) {
  return cn(
    'relative z-10 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-[border-radius,border-color] ease-out motion-reduce:transition-none',
    status === 'failed' && 'border-destructive',
    status === 'streaming' && 'border-primary/50',
    joined && 'rounded-b-none border-b-transparent'
  )
}

/** Vertical: a Prompt on its own, the same width as a Reply. */
export function PromptNode({data}: NodeProps<TurnNode>) {
  const {turn} = data

  if (turn.kind !== 'prompt') return null

  return (
    <div style={{width: TURN_WIDTH}}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <PromptBox
        promptId={turn.prompt.id}
        className="rounded-xl border border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground shadow-sm"
      >
        <PromptText prompt={turn.prompt} />
      </PromptBox>
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

  const input = useInputState(
    turn.kind === 'reply' ? turn.reply : null,
    hovered
  )

  if (turn.kind !== 'reply') return null

  return (
    <div style={{width: TURN_WIDTH}} {...hoverProps}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <ReplyTurn reply={turn.reply} joined={input === 'revealed'} />
      {input !== 'none' && (
        <ReplyInput
          reply={turn.reply}
          revealed={input === 'revealed'}
          stem={data.stem}
        />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className={hiddenHandle}
      />
    </div>
  )
}

function ReplyTurn({reply, joined}: {reply: Reply; joined: boolean}) {
  const {status} = useReply(reply)

  return (
    <div data-turn={reply.id} className={replyFrame(status, joined)}>
      <ReplyBody reply={reply} />
    </div>
  )
}

/** Horizontal: the Prompt as the card's header and its Reply as the body. */
export function ExchangeNode({data}: NodeProps<TurnNode>) {
  const {turn} = data
  const {hovered, hoverProps} = useHovered()

  const input = useInputState(
    turn.kind === 'exchange' ? turn.reply : null,
    hovered
  )

  if (turn.kind !== 'exchange') return null

  return (
    <div style={{width: TURN_WIDTH}} {...hoverProps}>
      <Handle type="target" position={Position.Left} className={hiddenHandle} />
      <ExchangeTurns
        prompt={turn.prompt}
        reply={turn.reply}
        joined={input === 'revealed'}
      />
      {turn.reply && input !== 'none' && (
        <ReplyInput reply={turn.reply} revealed={input === 'revealed'} />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={hiddenHandle}
      />
    </div>
  )
}

function ExchangeTurns({
  prompt,
  reply,
  joined,
}: {
  prompt: Prompt
  reply: Reply | null
  joined: boolean
}) {
  const status = useReply(reply)?.status ?? 'complete'

  return (
    <div className={replyFrame(status, joined)}>
      <PromptBox
        promptId={prompt.id}
        className="border-b border-border bg-prompt px-3.5 py-2.5 text-prompt-foreground"
      >
        <PromptText prompt={prompt} />
      </PromptBox>
      {reply && (
        <div data-turn={reply.id} className="relative">
          <ReplyBody reply={reply} />
        </div>
      )}
    </div>
  )
}
