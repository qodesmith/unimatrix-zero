import type {ImageLoadState} from '../image-load/machine'
import type {ExtraProps} from 'streamdown'

import {bridge} from '#modules/bridge/main'
import {useStateMachine} from '#modules/state-machine/main'
import {Button} from '#shadcn/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'

import {loadImage} from '../image-load/actions'
import {imageLoadTransition, initialImageLoad} from '../image-load/machine'

type ImageProps = React.JSX.IntrinsicElements['img'] & ExtraProps

const BUTTON_LABELS: Record<
  Exclude<ImageLoadState['status'], 'loaded'>,
  string
> = {
  unloaded: 'Load',
  loading: 'Loading…',
  failed: 'Try again',
}

function hostOf(url: string) {
  return new URL(url).host
}

function remoteUrl(src: ImageProps['src']): string | null {
  return src !== undefined && /^https?:/iu.test(src) ? src : null
}

/**
 * A chip until clicked, since nothing in a Reply reaches the network on its own
 * (ADR 0014). The click fetches the image through main, without cookies or a
 * referrer.
 */
export function RemoteImage({src, alt, title}: ImageProps) {
  const url = remoteUrl(src)

  return url ? (
    <RemoteImageChip url={url} alt={alt} title={title} />
  ) : (
    <span>{alt}</span>
  )
}

function RemoteImageChip({
  url,
  alt,
  title,
}: {
  url: string
  alt: ImageProps['alt']
  title: ImageProps['title']
}) {
  const [load, send] = useStateMachine({
    transition: imageLoadTransition,
    initial: initialImageLoad,
  })

  if (load.status === 'loaded') {
    return (
      <img
        src={load.dataUrl}
        alt={alt}
        title={title ?? alt}
        className="max-w-full rounded-md"
      />
    )
  }

  function ask() {
    if (imageLoadTransition(load, {type: 'loadAsked'}) === load) return

    send({type: 'loadAsked'})
    void loadImage({
      runLoad: async () => bridge().send({type: 'image.load', url}),
      send,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground" />
        }
      >
        <span>Image from {hostOf(url)}</span>
        {alt && <span className="truncate italic">{alt}</span>}
        {load.status === 'failed' && (
          <span className="text-destructive">{load.message}</span>
        )}
        <Button
          variant="link"
          disabled={load.status === 'loading'}
          onClick={ask}
          className="h-auto border-0 p-0 text-xs text-foreground underline-offset-2"
        >
          {BUTTON_LABELS[load.status]}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{url}</TooltipContent>
    </Tooltip>
  )
}
