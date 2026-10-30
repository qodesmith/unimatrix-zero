import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {Button, cn} from '#modules/shadcn/main'
import {ReplyView, useReply} from '#modules/turns/main'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {atBottom} from '../at-bottom'
import {useCanvas} from '../canvas-context'
import {dialogOpen} from '../dialog-open'
import {pathTo} from '../tree'
import {PromptInput} from './PromptInput'

interface ChatSlideoutProps {
  /** The Reply the shown Thread ends at. */
  end: Reply
  /** The Turn to start reading at, brought to the top as it changes. */
  scrollToTurnId: string
  /** Off: it slides away, then calls `onClosed` to be unmounted. */
  open: boolean
  onClose: () => void
  onClosed: () => void
  onFocus: (replyId: string) => void
  /** A Prompt was sent from the Input and main started this Reply for it. */
  onSent: (replyId: string) => void
}

/** Room left above the Turn scrolled to, in px. */
const SCROLL_MARGIN = 12

const SLIDE_MS = 300

/** Chat mode: one Thread as a conventional chat in a slideout over the canvas. */
export function ChatSlideout({
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
  const aside = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const thread = pathTo(index, end.id)

  // Esc in a field elsewhere, like a Tree's name, belongs to that field.
  useEffect(() => {
    if (!open) return undefined

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || dialogOpen()) {
        return
      }

      const {target} = event

      if (
        target instanceof Element &&
        target.matches('input, textarea') &&
        !aside.current?.contains(target)
      ) {
        return
      }

      onClose()
    }

    globalThis.addEventListener('keydown', onKeyDown)

    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) return undefined

    const timer = setTimeout(onClosed, SLIDE_MS)

    return () => clearTimeout(timer)
  }, [open, onClosed])

  useLayoutEffect(() => {
    const scroller = body.current
    const turn = scroller?.querySelector(`[data-chat-turn="${scrollToTurnId}"]`)

    if (!scroller || !turn) return

    scroller.scrollTop +=
      turn.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      SCROLL_MARGIN
    pinned.current = atBottom(scroller)
  }, [scrollToTurnId])

  // The Thread stays on the newest text until the user scrolls up.
  useEffect(() => {
    const scroller = body.current
    const inner = content.current

    if (!scroller || !inner) return undefined

    const observer = new ResizeObserver(() => {
      if (pinned.current) scroller.scrollTop = scroller.scrollHeight
    })

    observer.observe(scroller)
    observer.observe(inner)

    return () => observer.disconnect()
  }, [])

  return (
    <aside
      ref={aside}
      aria-label="Chat"
      inert={!open}
      style={{transitionDuration: `${SLIDE_MS}ms`}}
      className={cn(
        'absolute inset-y-0 right-0 z-10 flex flex-col bg-background transition-transform ease-out motion-reduce:transition-none starting:translate-x-full',
        full ? 'left-0' : 'w-110 max-w-full border-l border-border shadow-xl',
        !open && 'translate-x-full'
      )}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-xs text-muted-foreground">Thread</h2>
        <div className="flex gap-1">
          <HeaderButton
            title={full ? 'Exit full screen' : 'Full screen'}
            onClick={() => setFull(!full)}
          >
            {full ? '⤡' : '⤢'}
          </HeaderButton>
          <HeaderButton title="Close" onClick={onClose}>
            ✕
          </HeaderButton>
        </div>
      </header>
      <div
        ref={body}
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
    </aside>
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
    <div
      data-chat-turn={prompt.id}
      className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-prompt px-3.5 py-2 text-sm whitespace-pre-wrap text-prompt-foreground"
    >
      {prompt.text}
    </div>
  )
}

function ChatReply({reply}: {reply: Reply}) {
  const {status} = useReply(reply)

  return (
    <div
      data-chat-turn={reply.id}
      className={cn(
        'rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2 text-card-foreground shadow-sm',
        status === 'failed' && 'border-destructive',
        status === 'streaming' && 'border-primary/50'
      )}
    >
      <ReplyView reply={reply} />
    </div>
  )
}

interface ChatInputProps {
  end: Reply
  onFocus: (replyId: string) => void
  onSent: (replyId: string) => void
}

/**
 * Shares its draft with the same Reply's Input on the canvas. Keyed by the
 * Reply, so a send redraws it for the new one, which takes the focus over.
 */
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

function HeaderButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      className="size-7"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
