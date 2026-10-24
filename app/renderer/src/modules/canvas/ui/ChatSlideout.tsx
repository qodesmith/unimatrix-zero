import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {Button, cn} from '#modules/shadcn/main'
import {ReplyView, useLiveReply} from '#modules/turns/main'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {useCanvas} from '../canvas-context'
import {pathTo} from '../tree'
import {PromptInput} from './PromptInput'

interface ChatSlideoutProps {
  /** The Reply the shown Thread ends at, or a Prompt still waiting for one. */
  endTurnId: string
  /** The Turn to start reading at, brought to the top as it changes. */
  scrollToTurnId: string
  onClose: () => void
  /** The user is in the Input: its Thread becomes the Active Thread. */
  onFocus: (replyId: string) => void
  /** A Prompt was sent from the Input and main started this Reply for it. */
  onSent: (replyId: string) => void
}

/** Room left above the Turn scrolled to, in px. */
const SCROLL_MARGIN = 12

/**
 * Chat mode: one Thread as a conventional chat in a slideout over the canvas,
 * with one Input at its end. It can expand to cover the canvas; Esc closes it.
 */
export function ChatSlideout({
  endTurnId,
  scrollToTurnId,
  onClose,
  onFocus,
  onSent,
}: ChatSlideoutProps) {
  const {index} = useCanvas()
  const [full, setFull] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const thread = pathTo(index, endTurnId)
  const end = index.replyById.get(endTurnId) ?? null

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    globalThis.addEventListener('keydown', onKeyDown)

    return () => globalThis.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useLayoutEffect(() => {
    const scroller = body.current
    const turn = scroller?.querySelector(`[data-chat-turn="${scrollToTurnId}"]`)

    if (!scroller || !turn) return

    scroller.scrollTop +=
      turn.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      SCROLL_MARGIN
  }, [scrollToTurnId])

  return (
    <aside
      aria-label="Chat"
      className={cn(
        'absolute inset-y-0 right-0 z-10 flex flex-col bg-background',
        full ? 'left-0' : 'w-110 max-w-full border-l border-border shadow-xl'
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
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-180 flex-col gap-3">
          {thread.map(turnId => (
            <ChatTurn key={turnId} turnId={turnId} />
          ))}
        </div>
      </div>
      {end && <ChatInput end={end} onFocus={onFocus} onSent={onSent} />}
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
  const status = useLiveReply(reply.id)?.status ?? reply.status

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
 * The Input at the end of the Thread, once its Reply is done, sharing its
 * draft with that Reply's Input on the canvas.
 */
function ChatInput({end, onFocus, onSent}: ChatInputProps) {
  const {treeId, drafts, setDraft} = useCanvas()
  const status = useLiveReply(end.id)?.status ?? end.status

  if (status === 'streaming') return null

  return (
    <footer className="shrink-0 border-t border-border px-4 py-3">
      <div className="mx-auto max-w-180">
        <PromptInput
          key={end.id}
          treeId={treeId}
          parentReplyId={end.id}
          onFocus={() => onFocus(end.id)}
          onSent={onSent}
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
