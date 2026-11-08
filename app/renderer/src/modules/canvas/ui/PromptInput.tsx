import type {WantedModel} from '#modules/models/main'
import type {KeyboardEvent, Ref} from 'react'

import {ModelPicker, useModelPick} from '#modules/models/main'
import {useSettings} from '#modules/settings/main'
import {useSendPrompt} from '#modules/turns/main'
import {FieldError} from '#shadcn/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#shadcn/ui/input-group'
import {useRef, useState} from 'react'

import {useAttachedReply} from '../canvas-context'
import {StopButton} from './StopButton'

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
  /** False while the parent Reply streams: it takes a draft, not a send. */
  canSend?: boolean
  /** The streaming Reply whose Stop takes Send's place. */
  stopReplyId?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function PromptInput({
  treeId,
  parentReplyId,
  onFocus,
  onSent,
  draft: kept,
  onDraftChange,
  canSend = true,
  stopReplyId,
  ref,
}: PromptInputProps) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)
  const {sendKey} = useSettings()
  const form = useRef<HTMLFormElement>(null)
  const [ownDraft, setOwnDraft] = useState('')
  const draft = kept ?? ownDraft
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<WantedModel | null>(null)
  const pick = useModelPick(picked, useAttachedReply(parentReplyId))
  const {selected} = pick
  const held = !canSend || sending || pick.heldBecause !== null

  function updateDraft(text: string) {
    setOwnDraft(text)
    onDraftChange?.(text)
  }

  async function send() {
    if (held || !selected || draft.trim() === '') return

    const {provider, model} = selected

    setSending(true)
    const outcome = await sendPrompt(draft, {provider, model})
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
      ref={form}
      className="nowheel nopan w-full"
      onSubmit={event => {
        event.preventDefault()
        void send()
      }}
    >
      <InputGroup className="bg-background">
        <InputGroupTextarea
          ref={ref}
          aria-label="Prompt"
          rows={2}
          placeholder={parentReplyId === null ? 'Ask anything' : 'Reply…'}
          className="field-sizing-fixed min-h-0 px-3 text-sm md:text-sm"
          value={draft}
          onFocus={onFocus}
          onChange={event => updateDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon
          align="block-end"
          className="flex-wrap justify-between"
        >
          <FieldError className="text-xs">{error}</FieldError>
          <div className="ml-auto flex items-center gap-1">
            <ModelPicker pick={pick} onPick={setPicked} />
            {stopReplyId === undefined ? (
              <InputGroupButton
                type="submit"
                variant="default"
                size="sm"
                disabled={held || !selected || draft.trim() === ''}
              >
                Send
              </InputGroupButton>
            ) : (
              <StopButton
                treeId={treeId}
                replyId={stopReplyId}
                variant="default"
                onGoneWithFocus={() =>
                  form.current?.querySelector('textarea')?.focus()
                }
              />
            )}
          </div>
          {(pick.notice ?? pick.heldBecause) && (
            <p className="flex w-full flex-wrap justify-end gap-x-2 text-xs font-normal text-muted-foreground">
              {pick.notice && <span>{pick.notice}</span>}
              {pick.heldBecause && <span>{pick.heldBecause}</span>}
            </p>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
