import type {KeyboardEvent} from 'react'

import {Button} from '#modules/shadcn/main'
import {useSendPrompt} from '#modules/turns/main'
import {useState} from 'react'

interface PromptInputProps {
  treeId: string
  /** The Reply it continues from; null for an empty Tree's root Prompt. */
  parentReplyId: string | null
  /** The user is in this Input: its Thread becomes the active one. */
  onFocus?: () => void
  /** Flips as the user starts and stops typing a Prompt here. */
  onTypingChange?: (typing: boolean) => void
  /** The Reply main started for the sent Prompt. */
  onSent?: (replyId: string) => void
}

/** Where the user types the next Prompt. Enter sends; Shift+Enter breaks a line. */
export function PromptInput({
  treeId,
  parentReplyId,
  onFocus,
  onTypingChange,
  onSent,
}: PromptInputProps) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)

  function report(nextFocused: boolean, nextDraft: string) {
    setFocused(nextFocused)
    onTypingChange?.(nextFocused && nextDraft.trim() !== '')
  }

  async function send() {
    if (sending || draft.trim() === '') return

    setSending(true)
    const outcome = await sendPrompt(draft)
    setSending(false)

    if (!outcome.ok) {
      setError(outcome.error)

      return
    }

    setError(null)
    setDraft('')
    report(focused, '')
    onSent?.(outcome.reply.id)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <form
      className="nowheel flex w-full flex-col gap-2"
      onSubmit={event => {
        event.preventDefault()
        void send()
      }}
    >
      <textarea
        aria-label="Prompt"
        rows={2}
        placeholder={parentReplyId === null ? 'Ask anything' : 'Reply…'}
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm"
        value={draft}
        onFocus={() => {
          report(true, draft)
          onFocus?.()
        }}
        onBlur={() => report(false, draft)}
        onChange={event => {
          setDraft(event.target.value)
          report(focused, event.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-destructive">{error}</p>
        <Button
          type="submit"
          size="sm"
          disabled={sending || draft.trim() === ''}
        >
          Send
        </Button>
      </div>
    </form>
  )
}
