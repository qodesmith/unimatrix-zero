import type {FileAt} from '../tree-files-store'
import type {PreviewOpeners} from './PreviewBody'
import type {TreeFile, TreeFileDetails} from '@uz/contract/tree-files'

import {Refusal, useCommand} from '#modules/bridge/main'
import {Button} from '#shadcn/ui/button'
import {Spinner} from '#shadcn/ui/spinner'
import {formatSize} from '@uz/contract/sizes'
import {XIcon} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'

import {baseName} from '../file-kinds'
import {useTreeFileDetails} from '../preview-queries'
import {
  useCloseTreeFile,
  usePreviewedFile,
  useTreeFileList,
} from '../use-tree-files'
import {FileActions} from './FileActions'
import {PreviewBody} from './PreviewBody'

const CHANGES = {
  created: 'Created by this Reply',
  edited: 'Edited by this Reply',
  deleted: 'Deleted by this Reply',
}

/** Another dialog over the panel owns Esc; the slideout shares it. */
function dialogAbove() {
  return (
    document.querySelector(
      '[role="dialog"][data-open]:not([data-slideout]), [role="alertdialog"][data-open]'
    ) !== null
  )
}

function useEscapeCloses(panel: HTMLElement | null, close: () => void) {
  const closer = useRef(close)

  useEffect(() => {
    closer.current = close
  }, [close])

  useEffect(() => {
    if (!panel) return undefined

    const inPanel = panel

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || dialogAbove()) {
        return
      }

      const {target} = event

      // Esc in a field elsewhere, like a Tree's name, belongs to that field.
      if (
        target instanceof Element &&
        target.closest('input, textarea') &&
        !inPanel.contains(target)
      ) {
        return
      }

      event.preventDefault()
      closer.current()
    }

    globalThis.addEventListener('keydown', onKeyDown, true)

    return () => globalThis.removeEventListener('keydown', onKeyDown, true)
  }, [panel])
}

function Header({details, earlier}: {details: TreeFile; earlier: boolean}) {
  const deleted = details.change === 'deleted'

  const facts = [
    details.path,
    formatSize(details.size),
    details.change && CHANGES[details.change],
  ].filter(Boolean)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="truncate text-xs text-muted-foreground">
        {facts.join(' · ')}
      </p>
      {deleted && (
        <p className="text-xs text-muted-foreground">
          This is how it looked before this Reply deleted it.
        </p>
      )}
      {earlier && !deleted && (
        <p className="text-xs text-muted-foreground">
          How this file looked at this Turn.
        </p>
      )}
    </div>
  )
}

interface DescribedProps {
  at: FileAt
  details: TreeFileDetails
  earlier: boolean
}

function Described({at, details, earlier}: DescribedProps) {
  const {error, run} = useCommand()
  const fileId = details.id
  const opens = !details.executable && details.change !== 'deleted'

  const openers: PreviewOpeners = {
    open: opens
      ? () => void run({type: 'tree-file.open', fileId, with: 'default-app'})
      : null,
    quickLook: () =>
      void run({type: 'tree-file.open', fileId, with: 'quick-look'}),
  }

  return (
    <>
      <div className="border-b border-border px-4 pb-2">
        <Header details={details} earlier={earlier} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <PreviewBody at={at} details={details} openers={openers} />
      </div>
      <footer className="flex flex-col gap-2 border-t border-border px-4 py-2">
        <FileActions details={details} run={command => void run(command)} />
        <Refusal error={error} />
      </footer>
    </>
  )
}

function Listed({
  at,
  file,
  earlier,
}: {
  at: FileAt
  file: TreeFile
  earlier: boolean
}) {
  const details = useTreeFileDetails(at, file)

  if (details.isPending) return <Spinner className="m-4" />

  if (details.isError) return <Refusal error={details.error.message} />

  return <Described at={at} details={details.data} earlier={earlier} />
}

function Previewed({at}: {at: FileAt}) {
  const list = useTreeFileList(at.treeId, at.replyId)

  if (list.isPending) return <Spinner className="m-4" />

  if (list.isError) return <Refusal error={list.error.message} />

  const file = list.data.files.find(one => one.path === at.path)

  if (!file) {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        This file isn’t in the Tree’s files at this Turn.
      </p>
    )
  }

  return <Listed at={at} file={file} earlier={!list.data.onDisk} />
}

/** One file at a time, over the canvas beside the sidebar. */
export function TreeFilePreview() {
  const previewed = usePreviewedFile()
  const close = useCloseTreeFile()
  const [panel, setPanel] = useState<HTMLElement | null>(null)

  useEscapeCloses(panel, close)

  if (!previewed) return null

  return (
    <section
      ref={setPanel}
      role="dialog"
      aria-label="File preview"
      data-file-preview=""
      className="absolute inset-y-0 left-0 z-30 flex w-[min(460px,100%)] flex-col border-r border-border bg-background text-foreground shadow-xl"
    >
      <header className="flex items-start gap-2 px-4 pt-3 pb-1">
        <h2 className="min-w-0 flex-1 truncate font-medium">
          {baseName(previewed.path)}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close preview"
          onClick={close}
        >
          <XIcon />
        </Button>
      </header>
      <Previewed
        key={`${previewed.replyId}:${previewed.path}`}
        at={previewed}
      />
    </section>
  )
}
