import type {Draft} from '../drafts'
import type {KeyboardEvent, Ref} from 'react'

import {ModelPicker, useModelPick} from '#modules/models/main'
import {useSettings} from '#modules/settings/main'
import {FieldError} from '#shadcn/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#shadcn/ui/input-group'
import {useEffect, useRef, useState} from 'react'

import {useAttachedReply} from '../canvas-context'
import {EMPTY_DRAFT} from '../drafts'
import {usePromptSend} from '../prompt-send/use-prompt-send'
import {useReReadNote} from '../use-re-read-note'
import {StopButton} from './StopButton'

interface PromptInputProps {
  treeId: string
  /** The Reply it continues from; null for an empty Tree's root Prompt. */
  parentReplyId: string | null
  onFocus?: () => void
  /** The Reply main started for the sent Prompt. */
  onSent?: (replyId: string) => void
  /** The draft, kept by the caller so it outlives this Input's box. */
  draft?: Draft
  /** The draft as it changes; its text empty again once sent. */
  onDraftChange?: (draft: Draft) => void
  /** False while the parent Reply streams: it takes a draft, not a send. */
  canSend?: boolean
  /** The streaming Reply whose Stop takes Send's place. */
  stopReplyId?: string
  ref?: Ref<HTMLTextAreaElement>
}

/** What was typed after `sent` while main took it: the Input keeps that. */
function unsent(text: string, sent: string) {
  return text.startsWith(sent) ? text.slice(sent.length) : text
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
  const promptSend = usePromptSend(treeId, parentReplyId)
  const {sendKey} = useSettings()
  const form = useRef<HTMLFormElement>(null)
  const [ownDraft, setOwnDraft] = useState(EMPTY_DRAFT)
  const current = kept ?? ownDraft
  const {text: draft, model: picked} = current
  const latest = useRef(current)
  const attachedTo = useAttachedReply(parentReplyId)
  const pick = useModelPick(picked, attachedTo)
  const {selected} = pick

  const note = useReReadNote(attachedTo, selected)

  const sending = promptSend.state.status === 'sending'
  const held = !canSend || sending || pick.heldBecause !== null

  useEffect(() => {
    latest.current = current
  }, [current])

  function updateDraft(changes: Partial<Draft>) {
    const next = {...latest.current, ...changes}

    latest.current = next
    setOwnDraft(next)
    onDraftChange?.(next)
  }

  function send() {
    if (held || !selected || draft.trim() === '') return

    const {provider, model} = selected

    promptSend.submit({
      text: draft,
      model: {provider, model},
      onSent: replyId => {
        updateDraft({text: unsent(latest.current.text, draft)})
        onSent?.(replyId)
      },
    })
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return

    const sends =
      sendKey === 'enter' ? !event.shiftKey : event.metaKey || event.ctrlKey

    if (sends) {
      event.preventDefault()
      send()
    }
  }

  return (
    <form
      ref={form}
      className="nowheel nopan w-full"
      onSubmit={event => {
        event.preventDefault()
        send()
      }}
    >
      {note && (
        <p role="note" className="mb-1 px-1 text-xs text-muted-foreground">
          {note}
        </p>
      )}
      <InputGroup className="bg-background">
        <InputGroupTextarea
          ref={ref}
          aria-label="Prompt"
          rows={2}
          placeholder={parentReplyId === null ? 'Ask anything' : 'Reply…'}
          className="field-sizing-fixed min-h-0 px-3 text-sm md:text-sm"
          value={draft}
          onFocus={onFocus}
          onChange={event => updateDraft({text: event.target.value})}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon
          align="block-end"
          className="flex-wrap justify-between"
        >
          <FieldError className="text-xs">
            {promptSend.state.status === 'refused'
              ? promptSend.state.error
              : null}
          </FieldError>
          <div className="ml-auto flex items-center gap-1">
            <ModelPicker pick={pick} onPick={model => updateDraft({model})} />
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
