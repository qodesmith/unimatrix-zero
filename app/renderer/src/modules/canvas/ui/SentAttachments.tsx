import type {Prompt, Reply} from '@uz/contract/turns'

import {AttachmentList} from '#modules/attachments/main'

import {useCanvas} from '../canvas-context'
import {pathOnlyNow, threadEndFor} from '../inline-media'

interface SentAttachmentsProps {
  prompt: Prompt
  /**
   * The Reply ending the Thread the Prompt is shown on. Left out on the
   * canvas, where that is the Active Thread or else the Prompt's own.
   */
  threadEnd?: Reply
  className?: string
}

/**
 * A sent Prompt's attachments. One that Claude's media budget has since left
 * out of the Thread says it now goes by path only.
 */
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
