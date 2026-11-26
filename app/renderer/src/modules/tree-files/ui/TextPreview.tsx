import type {TextStart} from '../preview-queries'
import type {FileAt} from '../tree-files-store'
import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {ReactNode} from 'react'

import {Refusal} from '#modules/bridge/main'
import {ReplyMarkdown} from '#modules/markdown/main'
import {Button} from '#shadcn/ui/button'
import {Spinner} from '#shadcn/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#shadcn/ui/table'
import {formatSize} from '@uz/contract/sizes'

import {parseDelimited} from '../csv'
import {extensionOf} from '../file-kinds'
import {useTextStart} from '../preview-queries'

/** More rows would make the panel slow and nobody reads that far in it. */
const CSV_ROWS_SHOWN = 500

function CsvTable({text, path}: {text: string; path: string}) {
  const rows = parseDelimited(text, extensionOf(path) === 'tsv' ? '\t' : ',')
  const [header = [], ...body] = rows
  const shown = body.slice(0, CSV_ROWS_SHOWN)

  return (
    <div className="flex flex-col gap-2">
      {body.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {CSV_ROWS_SHOWN} rows of {body.length}.
        </p>
      )}
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {header.map((cell, column) => (
              // oxlint-disable-next-line react/no-array-index-key -- a column is its place in the row
              <TableHead key={column} scope="col">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row, line) => (
            // oxlint-disable-next-line react/no-array-index-key -- a row is its place in the file
            <TableRow key={line}>
              {row.map((cell, column) => (
                // oxlint-disable-next-line react/no-array-index-key -- a column is its place in the row
                <TableCell key={column} className="whitespace-pre-wrap">
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

type TextKind = Extract<TreeFileDetails['preview'], 'markdown' | 'csv' | 'text'>

interface BodyProps {
  kind: TextKind
  path: string
  start: TextStart
}

function Body({kind, path, start}: BodyProps) {
  switch (kind) {
    case 'markdown':
      return <ReplyMarkdown text={start.text} streaming={false} />
    case 'csv':
      return <CsvTable text={start.text} path={path} />
    case 'text':
      return (
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
          {start.text}
        </pre>
      )
    default:
      throw new Error('Unknown text preview.')
  }
}

interface TextPreviewProps {
  at: FileAt
  details: TreeFileDetails
  kind: TextKind
  /** Opens the whole file; null when the file may not be opened. */
  onOpen: (() => void) | null
}

/** Markdown, CSV and text: the file's start, and only that. */
export function TextPreview({at, details, kind, onOpen}: TextPreviewProps) {
  const start = useTextStart(at, details)

  if (start.isPending) return <Spinner />

  if (start.isError) return <Refusal error={start.error.message} />

  let cut: ReactNode = null

  if (start.data.shownSize < details.size) {
    cut = (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        <p>
          Showing the first {formatSize(start.data.shownSize)} of{' '}
          {formatSize(details.size)}.
        </p>
        {onOpen && (
          <Button variant="outline" size="xs" onClick={onOpen}>
            Open to see the rest
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {cut}
      <Body kind={kind} path={details.path} start={start.data} />
    </div>
  )
}
