import {cn} from 'cn'

type CssVariables = React.CSSProperties & Record<`--${string}`, number>

function AspectRatio({
  ratio,
  className,
  ...props
}: React.ComponentProps<'div'> & {ratio: number}) {
  const style: CssVariables = {'--ratio': ratio}

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
