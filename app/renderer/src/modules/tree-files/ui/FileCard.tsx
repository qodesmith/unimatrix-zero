import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {ReactNode} from 'react'

import {formatSize} from '@uz/contract/sizes'

import {baseName, iconOf, typeName} from '../file-kinds'

interface FileCardProps {
  details: TreeFileDetails
  note: string
  /** In place of the icon, such as the OS's thumbnail. */
  media?: ReactNode
  children?: ReactNode
}

/** What the app can say about a file it doesn't show. */
export function FileCard({details, note, media, children}: FileCardProps) {
  const Icon = iconOf(details)

  return (
    <div
      role="group"
      aria-label={baseName(details.path)}
      className="flex items-start gap-4 rounded-xl border border-border bg-muted p-4"
    >
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background text-muted-foreground">
        {/* oxlint-disable-next-line react/static-components -- picks one of lucide's icons, each made once at import */}
        {media ?? <Icon aria-hidden className="size-8" />}
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        <p className="truncate text-sm font-medium text-foreground">
          {baseName(details.path)}
        </p>
        <p>
          {typeName(details.path)} · {formatSize(details.size)}
        </p>
        {details.modified !== null && (
          <p>Modified {new Date(details.modified).toLocaleString()}</p>
        )}
        <p className="text-foreground">{note}</p>
        {children}
      </div>
    </div>
  )
}
