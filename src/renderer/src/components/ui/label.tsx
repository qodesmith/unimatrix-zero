import type {ComponentProps} from 'react'

import {cn} from '@/lib/utils'

function Label({className, ...props}: ComponentProps<'label'>) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- generic shadcn Label primitive: htmlFor or a wrapped control is supplied by consumers via spread props at usage sites
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export {Label}
