import type {ComponentProps} from 'react'

import {useReplyRun} from '#modules/turns/main'
import {SquareIcon} from 'lucide-react'

import {TooltipButton} from './TooltipButton'

type StopButtonProps = Pick<
  ComponentProps<typeof TooltipButton>,
  'variant' | 'className'
> & {treeId: string; replyId: string}

/** Taking no focus, so a click leaves it in the Input being written in. */
export function StopButton({
  treeId,
  replyId,
  variant,
  className,
}: StopButtonProps) {
  const {state, stop} = useReplyRun(treeId, replyId)
  const stopping = state.status === 'stopping'

  return (
    <>
      {state.status === 'stopRefused' && (
        <span className="min-w-0 text-xs text-destructive">{state.error}</span>
      )}
      <TooltipButton
        label={stopping ? 'Stopping…' : 'Stop'}
        variant={variant}
        className={className}
        disabled={stopping}
        onMouseDown={event => event.preventDefault()}
        onClick={stop}
      >
        <SquareIcon className="size-2.5 fill-current" />
      </TooltipButton>
    </>
  )
}
