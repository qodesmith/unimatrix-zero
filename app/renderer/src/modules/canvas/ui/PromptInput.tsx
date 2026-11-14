import type {Draft} from '../drafts'
import type {Attachment} from '@uz/contract/attachments'
import type {ComponentProps, DragEvent, KeyboardEvent, Ref} from 'react'

import {AttachmentList, useAttachmentAdds} from '#modules/attachments/main'
import {ModelPicker, useModelPick} from '#modules/models/main'
import {useSettings} from '#modules/settings/main'
import {FieldError} from '#shadcn/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '#shadcn/ui/input-group'
import {ATTACHMENTS_PER_PROMPT} from '@uz/contract/attachments'
import {useEffect, useRef, useState} from 'react'

import {useAttachedReply} from '../canvas-context'
import {EMPTY_DRAFT} from '../drafts'
import {usePromptSend} from '../prompt-send/use-prompt-send'
import {usePdfNote} from '../use-pdf-note'
import {useReReadNote} from '../use-re-read-note'
import {AttachButton} from './AttachButton'
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
  /** The draft as it changes; its text and attachments empty again once sent. */
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

/** What was attached after `sentIds` while main took the Prompt. */
function unsentAttachments(
  attachments: readonly Attachment[],
  sentIds: readonly string[]
) {
  return attachments.filter(({id}) => !sentIds.includes(id))
}

function carriesFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

function Notes({notes}: {notes: (string | null)[]}) {
  return notes.map(
    note =>
      note && (
        <p
          key={note}
          role="note"
          className="mb-1 px-1 text-xs text-muted-foreground"
        >
          {note}
        </p>
      )
  )
}

/** What the picker says about the Model it shows, and why Send waits. */
function PickNotes({pick}: {pick: ReturnType<typeof useModelPick>}) {
  if (!pick.notice && !pick.heldBecause) return null

  return (
    <p className="flex w-full flex-wrap justify-end gap-x-2 text-xs font-normal text-muted-foreground">
      {pick.notice && <span>{pick.notice}</span>}
      {pick.heldBecause && <span>{pick.heldBecause}</span>}
    </p>
  )
}

function DraftAttachments(props: ComponentProps<typeof AttachmentList>) {
  const {attachments, pending = []} = props

  if (attachments.length === 0 && pending.length === 0) return null

  return (
    <InputGroupAddon align="block-start">
      <AttachmentList {...props} />
    </InputGroupAddon>
  )
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
  const {text: draft, attachments, model: picked} = current
  const latest = useRef(current)
  const attachedTo = useAttachedReply(parentReplyId)
  const pick = useModelPick(picked, attachedTo)
  const {selected} = pick

  const reReadNote = useReReadNote(attachedTo, selected)
  const pdfNote = usePdfNote(attachedTo, attachments, selected)

  const adds = useAttachmentAdds(attachment =>
    updateDraft({attachments: [...latest.current.attachments, attachment]})
  )

  const sending = promptSend.state.status === 'sending'
  const adding = adds.pending.some(({status}) => status === 'adding')
  const tooMany = attachments.length - ATTACHMENTS_PER_PROMPT

  const held =
    !canSend || sending || adding || tooMany > 0 || pick.heldBecause !== null
  const empty = draft.trim() === '' && attachments.length === 0

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
    if (held || !selected || empty) return

    const {provider, model} = selected
    const attachmentIds = attachments.map(({id}) => id)

    promptSend.submit({
      text: draft,
      attachmentIds,
      model: {provider, model},
      onSent: replyId => {
        const now = latest.current

        updateDraft({
          text: unsent(now.text, draft),
          attachments: unsentAttachments(now.attachments, attachmentIds),
        })
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
      onDragOver={event => {
        if (carriesFiles(event)) event.preventDefault()
      }}
      onDrop={event => {
        if (!carriesFiles(event)) return

        event.preventDefault()
        adds.attach([...event.dataTransfer.files])
      }}
    >
      <Notes notes={[reReadNote, pdfNote]} />
      <InputGroup className="bg-background">
        <DraftAttachments
          attachments={attachments}
          pending={adds.pending}
          onRemove={id =>
            updateDraft({
              attachments: unsentAttachments(latest.current.attachments, [id]),
            })
          }
          onDismiss={adds.dismiss}
        />
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
          onPaste={event => {
            const files = [...event.clipboardData.files]

            if (files.length === 0) return

            event.preventDefault()
            adds.attach(files)
          }}
        />
        <InputGroupAddon
          align="block-end"
          className="flex-wrap justify-between"
        >
          <FieldError className="text-xs">
            {tooMany > 0
              ? `A Prompt takes at most ${ATTACHMENTS_PER_PROMPT} files; remove ${tooMany}.`
              : promptSend.state.status === 'refused'
                ? promptSend.state.error
                : null}
          </FieldError>
          <div className="ml-auto flex items-center gap-1">
            <AttachButton onPicked={adds.attach} />
            <ModelPicker pick={pick} onPick={model => updateDraft({model})} />
            {stopReplyId === undefined ? (
              <InputGroupButton
                type="submit"
                variant="default"
                size="sm"
                disabled={held || !selected || empty}
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
          <PickNotes pick={pick} />
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
