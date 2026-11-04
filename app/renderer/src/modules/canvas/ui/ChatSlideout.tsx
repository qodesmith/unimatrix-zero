import type {Prompt, Reply} from '@uz/contract/turns'

import {ReplyView, useReply} from '#modules/turns/main'
import {Bubble, BubbleContent} from '#shadcn/ui/bubble'
import {Message, MessageContent} from '#shadcn/ui/message'
import {Sheet, SheetContent} from '#shadcn/ui/sheet'
import {cn} from 'cn'
import {Maximize2Icon, Minimize2Icon, XIcon} from 'lucide-react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {atBottom} from '../at-bottom'
import {useCanvas} from '../canvas-context'
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
  const pinned = useRef(true)
  const thread = pathTo(index, end.id)

  function inFieldElsewhere({target}: Event) {
    return (
      target instanceof Element &&
      target.matches('input, textarea') &&
      !panel.current?.contains(target)
    )
  }

  useLayoutEffect(() => {
    const turn = scroller?.querySelector(`[data-chat-turn="${scrollToTurnId}"]`)

    if (!scroller || !turn) return

    scroller.scrollBy({
      top:
        turn.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        SCROLL_MARGIN,
    })
    pinned.current = atBottom(scroller)
  }, [scrollToTurnId, scroller])

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
        finalFocus={false}
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
            {thread.map(turnId => (
              <ChatTurn key={turnId} turnId={turnId} />
            ))}
          </div>
        </div>
        <ChatInput end={end} onFocus={onFocus} onSent={onSent} />
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
            status === 'failed' &&
              '*:data-[slot=bubble-content]:border-destructive',
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
  end: Reply
  onFocus: (replyId: string) => void
  onSent: (replyId: string) => void
}

/** Keyed by the Reply: a send redraws it for the new one, which takes focus. */
function ChatInput({end, onFocus, onSent}: ChatInputProps) {
  const {treeId, drafts, setDraft} = useCanvas()
  const {status} = useReply(end)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sentFor = useRef<string | null>(null)

  useEffect(() => {
    if (sentFor.current !== end.id) return

    sentFor.current = null
    textarea.current?.focus()
  }, [end.id])

  if (status === 'failed') return null

  return (
    <footer className="shrink-0 border-t border-border px-4 py-3">
      <div className="mx-auto max-w-180">
        <PromptInput
          key={end.id}
          ref={textarea}
          treeId={treeId}
          parentReplyId={end.id}
          canSend={status !== 'streaming'}
          onFocus={() => onFocus(end.id)}
          onSent={replyId => {
            sentFor.current = replyId
            onSent(replyId)
          }}
          draft={drafts.get(end.id) ?? ''}
          onDraftChange={text => setDraft(end.id, text)}
        />
      </div>
    </footer>
  )
}
