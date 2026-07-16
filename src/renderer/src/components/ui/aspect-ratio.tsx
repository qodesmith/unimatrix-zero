import type {CSSProperties, ComponentProps} from 'react'

import {useMemo} from 'react'

import {cn} from '@/lib/utils'

function AspectRatio({
  ratio,
  className,
  ...props
}: ComponentProps<'div'> & {ratio: number}) {
  const style = useMemo(
    () =>
      ({
        '--ratio': ratio,
      }) as CSSProperties,
    [ratio]
  )

  return (
    <div
      data-slot="aspect-ratio"
      style={style}
      className={cn('relative aspect-(--ratio)', className)}
      {...props}
    />
  )
}

export {AspectRatio}
