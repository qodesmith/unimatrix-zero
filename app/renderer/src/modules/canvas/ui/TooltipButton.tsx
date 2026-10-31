import type {ComponentProps} from 'react'

import {Button} from '#shadcn/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'

type TooltipButtonProps = ComponentProps<typeof Button> & {label: string}

export function TooltipButton({label, ...props}: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} {...props} />} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
