import type {ChangedFile} from '@uz/contract/turns'

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '#shadcn/ui/attachment'
import {formatSize} from '@uz/contract/sizes'
import {cn} from 'cn'
import {FilePenIcon, FilePlusIcon, FileXIcon} from 'lucide-react'

const CHANGES = {
  created: {verb: 'Created', Icon: FilePlusIcon, tone: 'text-success'},
  edited: {verb: 'Edited', Icon: FilePenIcon, tone: 'text-muted-foreground'},
  deleted: {verb: 'Deleted', Icon: FileXIcon, tone: 'text-destructive'},
}

function ChangedFileChip({file: {path, change, size}}: {file: ChangedFile}) {
  const {verb, Icon, tone} = CHANGES[change]
  const deleted = change === 'deleted'

  return (
    <Attachment
      role="group"
      aria-label={`${verb} ${path}`}
      title={path}
      size="xs"
      className={cn('min-w-0', deleted && 'opacity-60')}
    >
      <AttachmentMedia>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className={cn(deleted && 'line-through')}>
          {path.split('/').at(-1)}
        </AttachmentTitle>
        <AttachmentDescription className={tone}>
          {size === null ? verb : `${verb} · ${formatSize(size)}`}
        </AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  )
}

/**
 * The files a Reply changed, as chips like a Prompt's attachments, in path
 * order. Nothing for a Reply that changed none.
 */
export function ChangedFiles({files}: {files: readonly ChangedFile[]}) {
  if (files.length === 0) return null

  return (
    <AttachmentGroup
      role="group"
      aria-label="Files changed"
      className="flex-wrap gap-1.5 overflow-visible"
    >
      {files.map(file => (
        <ChangedFileChip key={file.path} file={file} />
      ))}
    </AttachmentGroup>
  )
}
