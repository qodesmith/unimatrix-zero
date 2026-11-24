import type {PendingAdd} from '../attachment-add/use-attachment-add'
import type {
  Attachment as AttachmentData,
  AttachmentKind,
} from '@uz/contract/attachments'
import type {ProviderId} from '@uz/contract/providers'

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
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'
import {
  attachmentKind,
  attachmentUrl,
  planInline,
} from '@uz/contract/attachments'
import {formatSize} from '@uz/contract/sizes'
import {cn} from 'cn'
import {
  CircleAlertIcon,
  FileIcon,
  FileSymlinkIcon,
  FileTextIcon,
  FolderIcon,
  XIcon,
} from 'lucide-react'
import {useId} from 'react'

import {FILE_MISSING, PATH_ONLY_NOW, modelUse} from '../model-use'

function RemoveButton({label, onClick}: {label: string; onClick: () => void}) {
  return (
    <AttachmentActions>
      <AttachmentAction aria-label={label} onClick={onClick}>
        <XIcon />
      </AttachmentAction>
    </AttachmentActions>
  )
}

interface ShownProps {
  attachment: AttachmentData
  note: string | null
  pathOnly: boolean
  onRemove?: () => void
}

function ImageAttachment({
  attachment: {id, name},
  note,
  pathOnly,
  onRemove,
}: ShownProps) {
  const src = attachmentUrl(id)
  const noteId = useId()

  return (
    <Attachment role="group" aria-label={name} size="xs" className="min-w-0">
      <Dialog>
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <AttachmentTrigger
                    aria-label={`Open ${name}`}
                    aria-describedby={note === null ? undefined : noteId}
                  />
                }
              />
            }
          />
          {note !== null && <TooltipContent>{note}</TooltipContent>}
        </Tooltip>
        <AttachmentMedia variant="image" className="w-12!">
          <img src={src} alt={name} className={cn(pathOnly && 'opacity-50')} />
          {pathOnly && (
            <span
              role="img"
              aria-label={PATH_ONLY_NOW}
              className="absolute right-0.5 bottom-0.5 flex size-4 items-center justify-center rounded-sm bg-muted text-muted-foreground"
            >
              <FileSymlinkIcon className="size-3" />
            </span>
          )}
        </AttachmentMedia>
        {note !== null && (
          <span id={noteId} className="sr-only">
            {note}
          </span>
        )}
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

const ICONS = {
  image: FileIcon,
  pdf: FileIcon,
  file: FileIcon,
  text: FileTextIcon,
  folder: FolderIcon,
} satisfies Record<AttachmentKind, typeof FileIcon>

function FileAttachment({
  attachment: {name, mediaType, size, folderPath},
  note,
  onRemove,
}: ShownProps) {
  const kind = attachmentKind(mediaType)
  const Icon = ICONS[kind]

  return (
    <Attachment role="group" aria-label={name} size="xs" className="min-w-0">
      <AttachmentMedia>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
        {folderPath === null ? (
          <AttachmentDescription>
            {[formatSize(size), note].filter(part => part !== null).join(' · ')}
          </AttachmentDescription>
        ) : (
          <>
            <AttachmentDescription title={folderPath}>
              {folderPath}
            </AttachmentDescription>
            {note !== null && (
              <AttachmentDescription>{note}</AttachmentDescription>
            )}
          </>
        )}
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
  provider?: ProviderId | null
  pathOnly?: ReadonlySet<string>
  pending?: readonly PendingAdd[]
  onRemove?: (id: string) => void
  onDismiss?: (key: string) => void
  className?: string
}

const NONE: readonly PendingAdd[] = []
const NO_IDS: ReadonlySet<string> = new Set()

export function AttachmentList({
  attachments,
  provider = null,
  pathOnly = NO_IDS,
  pending = NONE,
  onRemove,
  onDismiss,
  className,
}: AttachmentListProps) {
  if (attachments.length === 0 && pending.length === 0) return null

  // Planned together: one Prompt can pass Claude's media budget by itself.
  const forms = provider ? planInline(provider, [attachments]).forms[0] : null

  return (
    <AttachmentGroup
      role="group"
      aria-label="Attachments"
      className={cn('flex-wrap gap-1.5 overflow-visible', className)}
    >
      {attachments.map((attachment, at) => {
        const isPathOnly = pathOnly.has(attachment.id)

        const Shown =
          attachmentKind(attachment.mediaType) === 'image' &&
          !attachment.missing
            ? ImageAttachment
            : FileAttachment

        return (
          <Shown
            key={attachment.id}
            attachment={attachment}
            note={
              attachment.missing
                ? FILE_MISSING
                : isPathOnly
                  ? PATH_ONLY_NOW
                  : forms
                    ? modelUse(forms[at] ?? null, attachment)
                    : null
            }
            pathOnly={isPathOnly}
            onRemove={onRemove && (() => onRemove(attachment.id))}
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
