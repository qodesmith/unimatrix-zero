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
  /** The Reply main started for the sent Prompt. */
  onSent?: (replyId: string) => void
  /** The draft as it changes; empty again once sent. */
  onDraftChange?: (draft: string) => void
}

/** Where the user types the next Prompt. Enter sends; Shift+Enter breaks a line. */
export function PromptInput({
  treeId,
  parentReplyId,
  onFocus,
  onSent,
  onDraftChange,
}: PromptInputProps) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateDraft(text: string) {
    setDraft(text)
    onDraftChange?.(text)
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
    updateDraft('')
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
        onFocus={onFocus}
        onChange={event => updateDraft(event.target.value)}
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
