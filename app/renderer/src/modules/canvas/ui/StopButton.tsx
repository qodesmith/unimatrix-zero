import type {ComponentProps} from 'react'

import {useReplyRun} from '#modules/turns/main'
import {SquareIcon} from 'lucide-react'
import {useEffectEvent, useLayoutEffect, useRef} from 'react'

import {TooltipButton} from './TooltipButton'

type StopButtonProps = Pick<
  ComponentProps<typeof TooltipButton>,
  'variant' | 'className'
> & {
  treeId: string
  replyId: string
  /** Stop goes once its Reply ends, and must not drop focus to the body. */
  onGoneWithFocus: () => void
}

/** Taking no focus from a click, so it stays in the Input being written in. */
export function StopButton({
  treeId,
  replyId,
  variant,
  className,
  onGoneWithFocus,
}: StopButtonProps) {
  const {state, stop} = useReplyRun(treeId, replyId)
  const stopping = state.status === 'stopping'
  const button = useRef<HTMLButtonElement>(null)
  const handOffFocus = useEffectEvent(onGoneWithFocus)

  // A layout cleanup runs while the button is still in the page, holding focus.
  useLayoutEffect(() => {
    const node = button.current

    return () => {
      if (node && node === document.activeElement) handOffFocus()
    }
  }, [])

  return (
    <>
      {state.status === 'stopRefused' && (
        <span className="min-w-0 text-xs text-destructive">{state.error}</span>
      )}
      <TooltipButton
        ref={button}
        label={stopping ? 'Stopping…' : 'Stop'}
        variant={variant}
        className={className}
        disabled={stopping}
        focusableWhenDisabled
        onMouseDown={event => event.preventDefault()}
        onClick={stop}
      >
        <SquareIcon className="size-2.5 fill-current" />
      </TooltipButton>
    </>
  )
}
