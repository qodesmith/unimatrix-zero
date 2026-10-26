import type {ExtraProps} from 'streamdown'

import {bridge} from '#modules/bridge/main'
import {useState} from 'react'

type ImageProps = React.JSX.IntrinsicElements['img'] & ExtraProps

type LoadState =
  | {state: 'unloaded'}
  | {state: 'loading'}
  | {state: 'loaded'; dataUrl: string}
  | {state: 'failed'; message: string}

const BUTTON_LABELS: Record<Exclude<LoadState['state'], 'loaded'>, string> = {
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
 * A chip until clicked; the click fetches the image through main, without
 * cookies or a referrer.
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
  const [load, setLoad] = useState<LoadState>({state: 'unloaded'})

  if (load.state === 'loaded') {
    return (
      <img
        src={load.dataUrl}
        alt={alt}
        title={title ?? alt}
        className="max-w-full rounded-md"
      />
    )
  }

  async function loadImage() {
    setLoad({state: 'loading'})
    const outcome = await bridge().send({type: 'image.load', url})

    setLoad(
      outcome.ok
        ? {state: 'loaded', dataUrl: outcome.value.dataUrl}
        : {state: 'failed', message: outcome.error.message}
    )
  }

  return (
    <span
      title={url}
      className="inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
    >
      <span>Image from {hostOf(url)}</span>
      {alt && <span className="truncate italic">{alt}</span>}
      {load.state === 'failed' && (
        <span className="text-destructive">{load.message}</span>
      )}
      <button
        type="button"
        disabled={load.state === 'loading'}
        onClick={() => void loadImage()}
        className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
      >
        {BUTTON_LABELS[load.state]}
      </button>
    </span>
  )
}
