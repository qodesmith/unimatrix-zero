import type {Prompt, Reply} from '@uz/contract/turns'
import type {Ref} from 'react'

import {FailedChip, ReplyView, useReply} from '#modules/turns/main'
import {Bubble, BubbleContent} from '#shadcn/ui/bubble'
import {Message, MessageContent} from '#shadcn/ui/message'
import {Sheet, SheetContent} from '#shadcn/ui/sheet'
import {cn} from 'cn'
import {Maximize2Icon, Minimize2Icon, XIcon} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {atBottom} from '../at-bottom'
import {useCanvas} from '../canvas-context'
import {EMPTY_DRAFT} from '../drafts'
import {pathTo} from '../tree'
import {PromptInput} from './PromptInput'
import {TooltipButton} from './TooltipButton'

interface ChatSlideoutProps {
  container: HTMLElement | null
  end: Reply
  scrollToTurnId: string
  /** Off: it slides away, then calls `onClosed` to be unmounted. */
  open: boolean
  onClose: () => void
  onClosed: () => void
  onFocus: (replyId: string) => void
  /** Main started this Reply for a Prompt sent from the Input. */
  onSent: (replyId: string) => void
}

/** Room left above the Turn scrolled to, in px. */
const SCROLL_MARGIN = 12

/** Chat mode: one Thread as a conventional chat in a slideout over the canvas. */
export function ChatSlideout({
  container,
  end,
  scrollToTurnId,
  open,
  onClose,
  onClosed,
  onFocus,
  onSent,
}: ChatSlideoutProps) {
  const {index} = useCanvas()
  const [full, setFull] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  // The portal draws the body a render after the slideout mounts.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const pinned = useRef(true)

  const {status} = useReply(end)
  const failed = status === 'failed'
  const thread = pathTo(index, end.id)

  // A failed Reply shows only as a chip; its Prompt went back to the Input above.
  const shown = failed ? thread.slice(0, -2) : thread

  const inputAt = failed
    ? (index.promptById.get(end.promptId)?.parentReplyId ?? null)
    : end.id

  function inFieldElsewhere({target}: Event) {
    return (
      target instanceof Element &&
      target.matches('input, textarea') &&
      !panel.current?.contains(target)
    )
  }

  function returnFocus() {
    const {activeElement} = document

    // The closing panel is inert, which drops its focus to the body, so the body counts as the slideout's.
    const elsewhere =
      activeElement !== document.body &&
      !activeElement?.closest('[data-slideout]')

    return elsewhere ? false : (opener.current ?? false)
  }

  // Opening at a Turn, or following a send to its Reply, scrolls there and puts the user in the Input.
  useLayoutEffect(() => {
    const turn = scroller?.querySelector(`[data-chat-turn="${scrollToTurnId}"]`)

    if (!open || !scroller || !turn) return

    scroller.scrollBy({
      top:
        turn.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        SCROLL_MARGIN,
    })
    pinned.current = atBottom(scroller)

    const {activeElement} = document

    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      !panel.current?.contains(activeElement)
    ) {
      opener.current = activeElement
    }

    input.current?.focus({preventScroll: true})
  }, [open, scrollToTurnId, scroller])

  // The Thread stays on the newest text until the user scrolls up.
  useEffect(() => {
    const inner = content.current

    if (!scroller || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight
    })

    observer.observe(scroller)
    observer.observe(inner)

    return () => observer.disconnect()
  }, [scroller])

  return (
    <Sheet
      open={open}
      modal={false}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (next) return

        // Esc that a stop took, or Esc in a field elsewhere like a Tree's name, isn't the slideout's.
        if (
          details.reason === 'escape-key' &&
          (details.event.defaultPrevented || inFieldElsewhere(details.event))
        ) {
          details.cancel()

          return
        }

        onClose()
      }}
      onOpenChangeComplete={opened => {
        if (!opened) onClosed()
      }}
    >
      <SheetContent
        ref={panel}
        container={container}
        overlay={false}
        showCloseButton={false}
        initialFocus={false}
        finalFocus={returnFocus}
        aria-label="Chat"
        inert={!open}
        data-slideout=""
        // Base UI plays no enter for a popup that mounts open, so `starting:` slides it in.
        className={cn(
          'absolute z-10 max-w-full gap-0 bg-background bg-clip-border text-base text-foreground transition-[translate,opacity,width,box-shadow] data-[side=right]:sm:max-w-full starting:translate-x-[2.5rem] starting:opacity-0',
          full
            ? 'shadow-none data-[side=right]:w-full data-[side=right]:border-l-0'
            : 'shadow-xl data-[side=right]:w-110'
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-xs text-muted-foreground">Thread</h2>
          <div className="flex gap-1">
            <TooltipButton
              label={full ? 'Exit full screen' : 'Full screen'}
              className="size-7"
              onClick={() => setFull(!full)}
            >
              {full ? <Minimize2Icon /> : <Maximize2Icon />}
            </TooltipButton>
            <TooltipButton label="Close" className="size-7" onClick={onClose}>
              <XIcon />
            </TooltipButton>
          </div>
        </header>
        <div
          ref={setScroller}
          onScroll={event => {
            pinned.current = atBottom(event.currentTarget)
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          <div ref={content} className="mx-auto flex max-w-180 flex-col gap-3">
            {shown.map(turnId => (
              <ChatTurn key={turnId} turnId={turnId} />
            ))}
            {failed && (
              <div data-chat-turn={end.id}>
                <FailedChip reply={end} />
              </div>
            )}
          </div>
        </div>
        <ChatInput ref={input} at={inputAt} onFocus={onFocus} onSent={onSent} />
      </SheetContent>
    </Sheet>
  )
}

function ChatTurn({turnId}: {turnId: string}) {
  const {index} = useCanvas()
  const prompt = index.promptById.get(turnId)
  const reply = index.replyById.get(turnId)

  if (prompt) return <ChatPrompt prompt={prompt} />

  return reply ? <ChatReply reply={reply} /> : null
}

function ChatPrompt({prompt}: {prompt: Prompt}) {
  return (
    <Message align="end" data-chat-turn={prompt.id}>
      <MessageContent>
        <Bubble variant="prompt" align="end" className="max-w-[85%]">
          <BubbleContent className="rounded-2xl rounded-br-md px-3.5 whitespace-pre-wrap">
            {prompt.text}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function ChatReply({reply}: {reply: Reply}) {
  const {status} = useReply(reply)

  return (
    <Message data-chat-turn={reply.id}>
      <MessageContent>
        <Bubble
          variant="card"
          className={cn(
            'w-full max-w-full',
            status === 'streaming' &&
              '*:data-[slot=bubble-content]:border-primary/50'
          )}
        >
          <BubbleContent className="w-full rounded-2xl rounded-bl-md px-3.5">
            <ReplyView reply={reply} />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

interface ChatInputProps {
  ref: Ref<HTMLTextAreaElement>
  /** The Reply the Input continues from; null for the root Input. */
  at: string | null
  onFocus: (replyId: string) => void
  onSent: (replyId: string) => void
}

function ChatInput({ref, at, onFocus, onSent}: ChatInputProps) {
  const {treeId, index, drafts, setDraft} = useCanvas()
  const live = useReply(at === null ? null : (index.replyById.get(at) ?? null))
  const streaming = live?.status === 'streaming'

  return (
    <footer className="shrink-0 border-t border-border px-4 py-3">
      <div className="mx-auto max-w-180">
        <PromptInput
          key={at ?? 'root'}
          ref={ref}
          treeId={treeId}
          parentReplyId={at}
          canSend={!streaming}
          stopReplyId={streaming && at !== null ? at : undefined}
          onFocus={() => {
            if (at !== null) onFocus(at)
          }}
          onSent={onSent}
          draft={drafts.get(at) ?? EMPTY_DRAFT}
          onDraftChange={draft => setDraft(at, draft)}
        />
      </div>
    </footer>
  )
}
