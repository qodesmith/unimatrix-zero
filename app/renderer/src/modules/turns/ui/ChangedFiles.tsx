import type {ChangedFile, Reply} from '@uz/contract/turns'

import {useOpenTreeFile} from '#modules/tree-files/main'
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '#shadcn/ui/attachment'
import {formatSize} from '@uz/contract/sizes'
import {cn} from 'cn'
import {FilePenIcon, FilePlusIcon, FileXIcon} from 'lucide-react'

const CHANGES = {
  created: {verb: 'Created', Icon: FilePlusIcon},
  edited: {verb: 'Edited', Icon: FilePenIcon},
  deleted: {verb: 'Deleted', Icon: FileXIcon},
}

interface ChipProps {
  file: ChangedFile
  onOpen: () => void
}

function ChangedFileChip({file: {path, change, size}, onOpen}: ChipProps) {
  const {verb, Icon} = CHANGES[change]
  const deleted = change === 'deleted'

  return (
    <Attachment
      role="group"
      aria-label={`${verb} ${path}`}
      title={path}
      size="xs"
      className={cn('min-w-0', deleted && 'opacity-60')}
    >
      <AttachmentTrigger aria-label={`Open ${path}`} onClick={onOpen} />
      <AttachmentMedia>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className={cn(deleted && 'line-through')}>
          {path.split('/').at(-1)}
        </AttachmentTitle>
        <AttachmentDescription>
          {size === null ? verb : `${verb} · ${formatSize(size)}`}
        </AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  )
}

/** Each chip opens its file as it was at this Reply. */
export function ChangedFiles({reply}: {reply: Reply}) {
  const open = useOpenTreeFile()
  const {files, treeId, id: replyId} = reply

  if (files.length === 0) return null

  return (
    <AttachmentGroup
      role="group"
      aria-label="Files changed"
      className="flex-wrap gap-1.5 overflow-visible"
    >
      {files.map(file => (
        <ChangedFileChip
          key={file.path}
          file={file}
          onOpen={() => open({treeId, replyId, path: file.path})}
        />
      ))}
    </AttachmentGroup>
  )
}
