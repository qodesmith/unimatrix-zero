import type {KeyboardEvent, Ref} from 'react'

import {useSettings} from '#modules/settings/main'
import {Button} from '#modules/shadcn/main'
import {useSendPrompt} from '#modules/turns/main'
import {useState} from 'react'

interface PromptInputProps {
  treeId: string
  /** The Reply it continues from; null for an empty Tree's root Prompt. */
  parentReplyId: string | null
  onFocus?: () => void
  /** The Reply main started for the sent Prompt. */
  onSent?: (replyId: string) => void
  /** The draft, kept by the caller so it outlives this Input's box. */
  draft?: string
  /** The draft as it changes; empty again once sent. */
  onDraftChange?: (draft: string) => void
  /**
   * False while the Reply it continues from streams: it takes a draft, not a
   * send.
   */
  canSend?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

/** Where the user types the next Prompt. */
export function PromptInput({
  treeId,
  parentReplyId,
  onFocus,
  onSent,
  draft: kept,
  onDraftChange,
  canSend = true,
  ref,
}: PromptInputProps) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)
  const {sendKey} = useSettings()
  const [ownDraft, setOwnDraft] = useState('')
  const draft = kept ?? ownDraft
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateDraft(text: string) {
    setOwnDraft(text)
    onDraftChange?.(text)
  }

  async function send() {
    if (!canSend || sending || draft.trim() === '') return

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
    if (event.key !== 'Enter') return

    const sends =
      sendKey === 'enter' ? !event.shiftKey : event.metaKey || event.ctrlKey

    if (sends) {
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
        ref={ref}
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
          disabled={!canSend || sending || draft.trim() === ''}
        >
          Send
        </Button>
      </div>
    </form>
  )
}
