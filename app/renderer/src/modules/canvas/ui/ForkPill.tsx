import {Button} from '#shadcn/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'
import {cn} from 'cn'
import {ChevronDownIcon} from 'lucide-react'

import {useCanvas} from '../canvas-context'
import {isFork, repliesUnder} from '../tree'

export function ForkPill({
  replyId,
  branches,
}: {
  replyId: string
  branches: number
}) {
  const {index, toggleCollapsed} = useCanvas()
  const folded = useFolded(replyId)

  const streaming = folded
    ? repliesUnder(index, replyId).filter(one => one.status === 'streaming')
    : []

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={!folded}
            aria-label={
              streaming.length > 0
                ? `${branches} Branches, ${streaming.length} streaming`
                : undefined
            }
            className={cn(
              'h-auto gap-1 rounded-full border-border py-0.5 pr-2.5 pl-1.5 text-[0.6875rem] font-normal',
              folded
                ? 'bg-muted font-medium text-foreground shadow-xs hover:bg-muted dark:hover:bg-muted'
                : 'text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground',
              streaming.length > 0 && 'border-primary/50'
            )}
            onClick={() => toggleCollapsed(replyId)}
          />
        }
      >
        <ChevronDownIcon
          className={cn(
            'transition-transform duration-slide ease-slide motion-reduce:transition-none',
            folded && '-rotate-90'
          )}
        />
        {branches} Branches
        {streaming.length > 0 && (
          <span className="ml-0.5 size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {folded ? 'Show Branches' : 'Hide Branches'}
      </TooltipContent>
    </Tooltip>
  )
}

function useFolded(replyId: string | null) {
  const {index, collapsedReplyIds} = useCanvas()

  return (
    replyId !== null && isFork(index, replyId) && collapsedReplyIds.has(replyId)
  )
}

/**
 * Needs a positioned parent, and the box it peeks out under drawn after it. It
 * reaches no lower than the Input's -mt-3, or a hidden Input's stack shows
 * below the card.
 */
export function FoldedStack({replyId}: {replyId: string | null}) {
  if (!useFolded(replyId)) return null

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-x-4 -bottom-3 h-6 rounded-b-xl border border-border bg-card shadow-sm"
      />
      <div
        aria-hidden
        className="absolute inset-x-2 -bottom-1.5 h-6 rounded-b-xl border border-border bg-card shadow-sm"
      />
    </>
  )
}
