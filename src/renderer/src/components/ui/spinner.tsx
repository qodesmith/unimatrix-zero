import {Loader2Icon} from 'lucide-react'

import {cn} from '@/lib/utils'

function Spinner({className, ...props}: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the component renders an svg icon directly (React.ComponentProps<'svg'> is the public API), so the role must live on the svg rather than a wrapping output element
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export {Spinner}
