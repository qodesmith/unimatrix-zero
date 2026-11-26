import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {ReactNode} from 'react'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#shadcn/ui/item'
import {formatSize} from '@uz/contract/sizes'

import {baseName, iconOf, typeName} from '../file-kinds'

interface FileCardProps {
  details: TreeFileDetails
  note: string
  /** In place of the icon, such as the OS's thumbnail. */
  media?: ReactNode
  actions?: ReactNode
}

/** What the app can say about a file it doesn't show. */
export function FileCard({details, note, media, actions}: FileCardProps) {
  const Icon = iconOf(details)

  return (
    <Item
      variant="muted"
      role="group"
      aria-label={baseName(details.path)}
      className="flex-nowrap items-start"
    >
      <ItemMedia className="size-16 overflow-hidden rounded-xl bg-background text-muted-foreground">
        {/* oxlint-disable-next-line react/static-components -- picks one of lucide's icons, each made once at import */}
        {media ?? <Icon aria-hidden className="size-8" />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="block w-full truncate">
          {baseName(details.path)}
        </ItemTitle>
        <ItemDescription className="text-xs">
          {typeName(details.path)} · {formatSize(details.size)}
        </ItemDescription>
        {details.modified !== null && (
          <ItemDescription className="text-xs">
            Modified {new Date(details.modified).toLocaleString()}
          </ItemDescription>
        )}
        <ItemDescription className="line-clamp-none text-xs text-foreground">
          {note}
        </ItemDescription>
      </ItemContent>
      {actions && <ItemActions>{actions}</ItemActions>}
    </Item>
  )
}
