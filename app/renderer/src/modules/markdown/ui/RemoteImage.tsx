import type {ExtraProps} from 'streamdown'

import {bridge} from '#modules/bridge/main'
import {useState} from 'react'

type ImageProps = React.JSX.IntrinsicElements['img'] & ExtraProps

type Load =
  | {state: 'unloaded'}
  | {state: 'loading'}
  | {state: 'loaded'; dataUrl: string}
  | {state: 'failed'; message: string}

function hostOf(url: string) {
  return new URL(url).host
}

/** The image's address when it is a remote one; anything else has no chip. */
function remoteUrl(src: ImageProps['src']): string | null {
  return src !== undefined && /^https?:/iu.test(src) ? src : null
}

/**
 * A remote image in a Reply is a chip until the user clicks it: nothing in a
 * Reply reaches the network on its own (ADR 0014). The click fetches it
 * through main, without cookies or a referrer.
 */
export function RemoteImage({src, alt, title}: ImageProps) {
  const [load, setLoad] = useState<Load>({state: 'unloaded'})
  const url = remoteUrl(src)

  if (!url) return <span>{alt}</span>

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

  async function loadImage(from: string) {
    setLoad({state: 'loading'})
    const outcome = await bridge().send({type: 'image.load', url: from})

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
        onClick={() => void loadImage(url)}
        className="font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
      >
        {load.state === 'loading'
          ? 'Loading…'
          : load.state === 'failed'
            ? 'Try again'
            : 'Load'}
      </button>
    </span>
  )
}
