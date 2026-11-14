import type {PendingAdd} from '../attachment-add/use-attachment-adds'
import type {Attachment as AttachmentData} from '@uz/contract/attachments'

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '#shadcn/ui/attachment'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '#shadcn/ui/dialog'
import {Spinner} from '#shadcn/ui/spinner'
import {attachmentKind, attachmentUrl} from '@uz/contract/attachments'
import {cn} from 'cn'
import {CircleAlertIcon, FileIcon, FileTextIcon, XIcon} from 'lucide-react'

import {formatSize} from '../size'

function RemoveButton({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <AttachmentActions>
      <AttachmentAction aria-label={label} onClick={onClick}>
        <XIcon />
      </AttachmentAction>
    </AttachmentActions>
  )
}

/** A thumbnail that opens the image large in a lightbox. */
function ImageAttachment({
  attachment: {id, name},
  onRemove,
}: {
  attachment: AttachmentData
  onRemove?: () => void
}) {
  const src = attachmentUrl(id)

  return (
    <Attachment role="group" aria-label={name} size="xs" className="min-w-0">
      <Dialog>
        <DialogTrigger
          render={<AttachmentTrigger aria-label={`Open ${name}`} />}
        />
        <AttachmentMedia variant="image" className="w-12!">
          <img src={src} alt={name} />
        </AttachmentMedia>
        <DialogContent className="max-w-[calc(100%-4rem)] p-3 sm:max-w-[min(64rem,calc(100%-4rem))]">
          <DialogTitle className="truncate pr-8">{name}</DialogTitle>
          <img
            src={src}
            alt={name}
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
        </DialogContent>
      </Dialog>
      {onRemove && <RemoveButton label={`Remove ${name}`} onClick={onRemove} />}
    </Attachment>
  )
}

/** Any other file: a chip with its name and size. */
function FileAttachment({
  attachment: {name, mediaType, size},
  onRemove,
}: {
  attachment: AttachmentData
  onRemove?: () => void
}) {
  const Icon = attachmentKind(mediaType) === 'text' ? FileTextIcon : FileIcon

  return (
    <Attachment role="group" aria-label={name} size="xs" className="min-w-0">
      <AttachmentMedia>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        <AttachmentDescription>{formatSize(size)}</AttachmentDescription>
      </AttachmentContent>
      {onRemove && <RemoveButton label={`Remove ${name}`} onClick={onRemove} />}
    </Attachment>
  )
}

function PendingAttachment({
  add,
  onDismiss,
}: {
  add: PendingAdd
  onDismiss: () => void
}) {
  const refused = add.status === 'refused'

  return (
    <Attachment
      role="group"
      aria-label={add.name}
      size="xs"
      state={refused ? 'error' : 'uploading'}
      className="min-w-0"
    >
      <AttachmentMedia>
        {refused ? <CircleAlertIcon /> : <Spinner aria-label="Adding" />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{add.name}</AttachmentTitle>
        <AttachmentDescription role={refused ? 'alert' : undefined}>
          {refused ? add.error : 'Adding…'}
        </AttachmentDescription>
      </AttachmentContent>
      <RemoveButton
        label={refused ? `Dismiss ${add.name}` : `Remove ${add.name}`}
        onClick={onDismiss}
      />
    </Attachment>
  )
}

interface AttachmentListProps {
  attachments: readonly AttachmentData[]
  /** Files still being added, and those main refused. */
  pending?: readonly PendingAdd[]
  /** Given, each attachment offers to be removed. */
  onRemove?: (id: string) => void
  onDismiss?: (key: string) => void
  className?: string
}

const NONE: readonly PendingAdd[] = []

/** Images as thumbnails, other files as chips, in the order attached. */
export function AttachmentList({
  attachments,
  pending = NONE,
  onRemove,
  onDismiss,
  className,
}: AttachmentListProps) {
  if (attachments.length === 0 && pending.length === 0) return null

  return (
    <AttachmentGroup
      role="group"
      aria-label="Attachments"
      className={cn('flex-wrap gap-1.5 overflow-visible', className)}
    >
      {attachments.map(attachment => {
        const remove = onRemove && (() => onRemove(attachment.id))

        return attachmentKind(attachment.mediaType) === 'image' ? (
          <ImageAttachment
            key={attachment.id}
            attachment={attachment}
            onRemove={remove}
          />
        ) : (
          <FileAttachment
            key={attachment.id}
            attachment={attachment}
            onRemove={remove}
          />
        )
      })}
      {pending.map(add => (
        <PendingAttachment
          key={add.key}
          add={add}
          onDismiss={() => onDismiss?.(add.key)}
        />
      ))}
    </AttachmentGroup>
  )
}
