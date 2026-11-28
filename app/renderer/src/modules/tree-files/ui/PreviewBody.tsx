import type {FileAt} from '../tree-files-store'
import type {TextPreviewProps} from './TextPreview'
import type {TreeFileDetails} from '@uz/contract/tree-files'

import {Button} from '#shadcn/ui/button'
import {ToggleGroup, ToggleGroupItem} from '#shadcn/ui/toggle-group'
import {treeFileUrl} from '@uz/contract/tree-files'
import {cn} from 'cn'
import {useState} from 'react'

import {baseName} from '../file-kinds'
import {useThumbnail} from '../preview-queries'
import {FileCard} from './FileCard'
import {PdfPreview} from './PdfPreview'
import {TextPreview} from './TextPreview'

type Fit = 'fit' | 'actual'

/** Only ever an `<img>`, SVG too: a script in an SVG never runs there. */
function ImagePreview({details}: {details: TreeFileDetails}) {
  const [fit, setFit] = useState<Fit>('fit')

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        aria-label="Image size"
        spacing={0}
        value={[fit]}
        onValueChange={([next]) => {
          if (next === 'fit' || next === 'actual') setFit(next)
        }}
        className="self-start rounded-lg bg-muted p-0.5"
      >
        <ToggleGroupItem value="fit" size="sm" className="h-7 px-2 text-xs">
          Fit
        </ToggleGroupItem>
        <ToggleGroupItem value="actual" size="sm" className="h-7 px-2 text-xs">
          Actual size
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="overflow-auto">
        <img
          src={treeFileUrl(details.id)}
          alt={baseName(details.path)}
          className={cn(
            'rounded-lg border border-border',
            fit === 'fit' ? 'h-auto max-w-full' : 'max-w-none'
          )}
        />
      </div>
    </div>
  )
}

function MediaPreview({details}: {details: TreeFileDetails}) {
  const [failed, setFailed] = useState(false)
  const video = details.preview === 'video'

  if (failed) {
    return (
      <FileCard
        details={details}
        note={
          video ? 'This video can’t play here.' : 'This audio can’t play here.'
        }
      />
    )
  }

  const source = {
    src: treeFileUrl(details.id),
    controls: true,
    onError: () => setFailed(true),
  }

  return video ? (
    <video {...source} className="w-full rounded-lg bg-muted" />
  ) : (
    <audio {...source} className="w-full" />
  )
}

/** Scripts run, with no network and no access to the app (ADR 0014). */
function HtmlPreview({details}: {details: TreeFileDetails}) {
  return (
    <iframe
      sandbox="allow-scripts"
      src={treeFileUrl(details.id, 'html')}
      title={baseName(details.path)}
      className="h-[60vh] w-full rounded-lg border border-border bg-background"
    />
  )
}

interface OsCardProps {
  at: FileAt
  details: TreeFileDetails
  onQuickLook: () => void
}

function OsCard({at, details, onQuickLook}: OsCardProps) {
  const thumbnail = useThumbnail(at, details)

  return (
    <FileCard
      details={details}
      note="The app can’t show this file, but macOS can."
      media={
        thumbnail.data ? (
          <img src={thumbnail.data} alt="" className="size-full object-cover" />
        ) : undefined
      }
      actions={
        <Button variant="outline" size="xs" onClick={onQuickLook}>
          Quick Look
        </Button>
      }
    />
  )
}

export interface PreviewOpeners {
  open: TextPreviewProps['onOpen']
  quickLook: () => void
}

interface PreviewBodyProps {
  at: FileAt
  details: TreeFileDetails
  openers: PreviewOpeners
}

export function PreviewBody({at, details, openers}: PreviewBodyProps) {
  if (details.link) {
    return (
      <FileCard
        details={details}
        note="This is a link to another file. The app doesn’t follow links."
      />
    )
  }

  if (details.size === 0) {
    return <FileCard details={details} note="This file is empty." />
  }

  if (details.tooLarge) {
    return <FileCard details={details} note="Too large to preview here." />
  }

  switch (details.preview) {
    case 'image':
      return <ImagePreview details={details} />
    case 'audio':
    case 'video':
      return <MediaPreview details={details} />
    case 'pdf':
      return <PdfPreview file={details} />
    case 'markdown':
    case 'csv':
    case 'text':
      return (
        <TextPreview
          at={at}
          details={details}
          kind={details.preview}
          onOpen={openers.open}
        />
      )
    case 'html':
      return <HtmlPreview details={details} />
    case 'other':
      return details.quickLook ? (
        <OsCard at={at} details={details} onQuickLook={openers.quickLook} />
      ) : (
        <FileCard
          details={details}
          note="The app can’t preview this type of file."
        />
      )
    default:
      throw new Error('Unknown preview.')
  }
}
