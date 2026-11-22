import type {Prompt, Reply} from '@uz/contract/turns'

import {AttachmentList} from '#modules/attachments/main'

import {useCanvas} from '../canvas-context'
import {pathOnlyNow, threadEndFor} from '../media-budget'

interface SentAttachmentsProps {
  prompt: Prompt
  /** Left out on the canvas, which uses the Active Thread's end. */
  threadEnd?: Reply
  className?: string
}

export function SentAttachments({
  prompt,
  threadEnd,
  className,
}: SentAttachmentsProps) {
  const {index, activeReplyId} = useCanvas()
  const end = threadEnd ?? threadEndFor(index, activeReplyId, prompt)

  return (
    <AttachmentList
      attachments={prompt.attachments}
      pathOnly={pathOnlyNow(index, end, prompt)}
      className={className}
    />
  )
}
