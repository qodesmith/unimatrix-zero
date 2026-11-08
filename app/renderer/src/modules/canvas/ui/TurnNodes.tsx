import type {CanvasLayoutNode} from '../canvas-layout'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {Node, NodeProps} from '@xyflow/react'
import type {Ref} from 'react'

import {useSettings} from '#modules/settings/main'
import {FailedChip, ReplyView, useReply} from '#modules/turns/main'
import {Card} from '#shadcn/ui/card'
import {Handle, Position} from '@xyflow/react'
import {cn} from 'cn'
import {ChevronRightIcon} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

import {useCanvas} from '../canvas-context'
import {TURN_WIDTH} from '../canvas-layout'
import {EMPTY_DRAFT} from '../drafts'
import {branchesOf, isFork, previousReply} from '../tree'
import {CappedText} from './CappedText'
import {ContextMeter, ContextSize} from './ContextSize'
import {FoldedStack, ForkPill} from './ForkPill'
import {PromptBox} from './PromptBox'
import {PromptInput} from './PromptInput'
import {StopButton} from './StopButton'
import {TooltipButton} from './TooltipButton'

/** A vertical Reply's line down through its Input's space, drawn as its edge. */
export type Stem = 'none' | 'plain' | 'on-thread'

export type TurnNode = Node<
  {turn: CanvasLayoutNode; stem: Stem},
  CanvasLayoutNode['kind']
>

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
  const bottomChatButton = useRef<HTMLButtonElement>(null)

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
        <OpenChatButton replyId={reply.id} className="ml-auto" />
      </header>
      <CappedText
        limit={limitTurnHeight}
        maxHeightClass="max-h-72"
        expanded={expandedTurnIds.has(reply.id)}
        onToggle={() => toggleExpanded(reply.id)}
        streaming={status === 'streaming'}
        trailing={
          <>
            {isFork(index, reply.id) && (
              <ForkPill
                replyId={reply.id}
                branches={branchesOf(index, reply.id).length}
              />
            )}
            {status === 'streaming' && (
              <StopButton
                treeId={reply.treeId}
                replyId={reply.id}
                className="size-6 text-muted-foreground"
                onGoneWithFocus={() =>
                  bottomChatButton.current?.focus({preventScroll: true})
                }
              />
            )}
            <OpenChatButton ref={bottomChatButton} replyId={reply.id} />
          </>
        }
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

function OpenChatButton({
  replyId,
  className,
  ref,
}: {
  replyId: string
  className?: string
  ref?: Ref<HTMLButtonElement>
}) {
  const {openChat} = useCanvas()

  return (
    <TooltipButton
      ref={ref}
      label="Open in Chat mode"
      className={cn('size-6 text-muted-foreground', className)}
      onClick={() => openChat(replyId)}
    >
      <ChevronRightIcon />
    </TooltipButton>
  )
}

type InputState = 'none' | 'hidden' | 'revealed'

function useInputState(reply: Reply | null, hovered: boolean): InputState {
  const {activeReplyId, drafts} = useCanvas()
  const live = useReply(reply)

  if (!live || live.status === 'failed') return 'none'

  const draft = drafts.get(live.id)?.text ?? ''

  return activeReplyId === live.id || draft.trim() !== '' || hovered
    ? 'revealed'
    : 'hidden'
}

/**
 * Slid up behind the box above, not unmounted, so revealing it shifts nothing.
 * It starts a corner's radius up inside the box, so it fills the corners as
 * they square.
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
            'absolute inset-y-0 left-1/2 -translate-x-1/2 transition-opacity duration-slide ease-slide motion-reduce:transition-none',
            stem === 'on-thread'
              ? 'w-[2.5px] bg-thread-highlight'
              : 'w-[1.5px] bg-canvas-edge',
            revealed && 'opacity-0',
            'in-[.canvas-switching]:opacity-0 in-[.canvas-switching]:transition-none'
          )}
        />
      )}
      <div className="-mt-3 [clip-path:inset(0_-0.5rem_-1rem)]">
        <div
          data-revealed={revealed}
          className={cn(
            'relative transition-[translate] duration-slide ease-slide motion-reduce:transition-none',
            !revealed && '-translate-y-full focus-within:translate-y-0'
          )}
        >
          <FoldedStack replyId={replyId} />
          <div
            className={cn(
              'relative rounded-b-xl border border-t-0 border-border bg-card px-3.5 pt-5.5 pb-2.5 shadow-sm',
              streaming && 'border-primary/50'
            )}
          >
            <PromptInput
              ref={textarea}
              treeId={treeId}
              parentReplyId={replyId}
              canSend={!streaming}
              onFocus={() => onInputFocus(replyId)}
              onSent={sent => onSent(sent, replyId)}
              draft={drafts.get(replyId) ?? EMPTY_DRAFT}
              onDraftChange={draft => setDraft(replyId, draft)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

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
 * `text-base` overrides Card's text-sm, so the text follows the font size
 * Setting.
 */
function replyFrame(status: Reply['status'], joined: boolean) {
  return cn(
    'relative z-10 gap-0 rounded-xl border border-border py-0 text-base shadow-sm ring-0 transition-[border-radius,border-color] duration-slide ease-slide motion-reduce:transition-none',
    status === 'streaming' && 'border-primary/50',
    joined && 'rounded-b-none border-b-transparent'
  )
}

/** Vertical: a Prompt on its own. */
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

/** Vertical: a Reply on its own. */
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
    <div className="relative">
      <FoldedStack replyId={reply.id} />
      <Card data-turn={reply.id} className={replyFrame(status, joined)}>
        <ReplyBody reply={reply} />
      </Card>
    </div>
  )
}

/** Horizontal: a Prompt and its Reply in one card. */
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
    <div className="relative">
      <FoldedStack replyId={reply?.id ?? null} />
      <Card className={replyFrame(status, joined)}>
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
      </Card>
    </div>
  )
}

/** The Input a failed root Prompt went back to, with nothing above it. */
function RootInput({failedReplyId}: {failedReplyId: string}) {
  const {treeId, onInputFocus, onSent, drafts, setDraft} = useCanvas()

  return (
    <div data-revealed="true" className="mt-3">
      <PromptInput
        treeId={treeId}
        parentReplyId={null}
        onFocus={() => onInputFocus(failedReplyId)}
        onSent={sent => onSent(sent, null)}
        draft={drafts.get(null) ?? EMPTY_DRAFT}
        onDraftChange={draft => setDraft(null, draft)}
      />
    </div>
  )
}

/** Either orientation: a failed Reply and its Prompt as one chip. */
export function FailedNode({data}: NodeProps<TurnNode>) {
  const {turn} = data
  const vertical = useSettings().canvasOrientation === 'vertical'

  if (turn.kind !== 'failed') return null

  return (
    <div style={{width: TURN_WIDTH}}>
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className={hiddenHandle}
      />
      <FailedChip reply={turn.reply} />
      {turn.prompt.parentReplyId === null && (
        <RootInput failedReplyId={turn.reply.id} />
      )}
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className={hiddenHandle}
      />
    </div>
  )
}
