import type {Command, TreeFileOpenWith} from '@uz/contract/commands'
import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {ReactNode} from 'react'

import {Button} from '#shadcn/ui/button'

type Run = (command: Command) => void

type OpenWith = Exclude<TreeFileOpenWith, 'quick-look'>

const NOT_OPENED = {
  program:
    'This file is marked as a program, and the app never opens programs.',
  'not-a-document':
    'The app opens only documents, and this kind of file can run as a program.',
} satisfies Record<NonNullable<TreeFileDetails['notOpened']>, string>

const REVEAL = {
  finder: 'Reveal in Finder',
  explorer: 'Show in File Explorer',
  other: 'Show in folder',
} satisfies Record<TreeFileDetails['fileManager'], string>

interface FileActionsProps {
  details: TreeFileDetails
  run: Run
}

function Action({onClick, children}: {onClick: () => void; children: string}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {children}
    </Button>
  )
}

function actionsFor({details, run}: FileActionsProps): ReactNode {
  const fileId = details.id

  function open(how: OpenWith) {
    return () => run({type: 'tree-file.open', fileId, with: how})
  }

  function reveal() {
    run({type: 'tree-file.reveal', fileId})
  }

  function saveCopy() {
    run({type: 'tree-file.save-copy', fileId})
  }

  if (details.change === 'deleted') {
    return <Action onClick={saveCopy}>Save a copy…</Action>
  }

  const editor = details.editor !== null && (
    <Action onClick={open('editor')}>{`Open in ${details.editor}`}</Action>
  )

  if (details.notOpened !== null) {
    return details.onDisk ? (
      <>
        <Action onClick={reveal}>{REVEAL[details.fileManager]}</Action>
        {editor}
      </>
    ) : (
      <Action onClick={saveCopy}>Save a copy…</Action>
    )
  }

  const browser = details.preview === 'html' && (
    <Action onClick={open('browser')}>Open in browser</Action>
  )

  if (!details.onDisk) {
    return (
      <>
        {browser}
        <Action onClick={open('default-app')}>Open this version</Action>
        <Action onClick={saveCopy}>Save a copy…</Action>
      </>
    )
  }

  return (
    <>
      {browser}
      <Action onClick={open('default-app')}>Open in default app</Action>
      <Action onClick={reveal}>{REVEAL[details.fileManager]}</Action>
      {editor}
    </>
  )
}

/** Opening needs the file in the Tree's folder, or a read-only copy of it. */
export function FileActions(props: FileActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      {props.details.notOpened !== null && (
        <p className="text-xs text-muted-foreground">
          {NOT_OPENED[props.details.notOpened]}
        </p>
      )}
      <div className="flex flex-wrap gap-2">{actionsFor(props)}</div>
    </div>
  )
}
