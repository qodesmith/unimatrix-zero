import type {Tree} from '@uz/contract/trees'
import type {KeyboardEvent} from 'react'

import {useTreeStreaming} from '#modules/turns/main'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#shadcn/ui/dropdown-menu'
import {Input} from '#shadcn/ui/input'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#shadcn/ui/sidebar'
import {TREE_TITLE_MAX_LENGTH} from '@uz/contract/trees'
import {MoreHorizontalIcon} from 'lucide-react'
import {useId, useRef, useState} from 'react'

import {relativeTime} from '../relative-time'
import {treeName} from '../tree-name'
import {useNow} from '../use-now'

export function TreeTitle({tree}: {tree: Tree}) {
  return tree.title ?? <span className="italic">{treeName(tree)}</span>
}

interface TreeRowProps {
  tree: Tree
  isOpen: boolean
  renaming: boolean
  onOpen: () => void
  onStartRename: () => void
  /** The new title, or null when renaming was abandoned. */
  onRenamed: (title: string | null) => void
  onDelete: () => void
}

export function TreeRow({
  tree,
  isOpen,
  renaming,
  onOpen,
  onStartRename,
  onRenamed,
  onDelete,
}: TreeRowProps) {
  const detailsId = useId()
  const renameChosen = useRef(false)

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'F2') onStartRename()
  }

  if (renaming) {
    return (
      <SidebarMenuItem>
        <RenameInput tree={tree} onDone={onRenamed} />
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isOpen}
        aria-current={isOpen ? 'page' : undefined}
        aria-describedby={detailsId}
        className="pr-16"
        onClick={onOpen}
        onDoubleClick={onStartRename}
        onKeyDown={onKeyDown}
      >
        <span data-slot="tree-title">
          <TreeTitle tree={tree} />
        </span>
      </SidebarMenuButton>
      <TreeDetails id={detailsId} tree={tree} />
      <DropdownMenu
        onOpenChange={open => {
          if (open) renameChosen.current = false
        }}
      >
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover />}
          aria-label={`Actions for ${treeName(tree)}`}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-auto"
          // Rename unmounts this trigger, so Base UI would return focus to an
          // older element still on the page and blur the rename input.
          finalFocus={() => !renameChosen.current}
        >
          <DropdownMenuItem
            onClick={() => {
              renameChosen.current = true
              onStartRename()
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

/**
 * Gives way to the ⋯ button where the row is hovered, focused or has its menu
 * open.
 */
function TreeDetails({id, tree}: {id: string; tree: Tree}) {
  const streaming = useTreeStreaming(tree.id)
  const now = useNow()

  return (
    <span
      id={id}
      className="pointer-events-none absolute top-1.5 right-2 flex h-5 items-center gap-1.5 text-xs text-muted-foreground tabular-nums group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 group-has-aria-expanded/menu-item:opacity-0"
    >
      <time dateTime={tree.lastActiveAt}>
        {relativeTime(tree.lastActiveAt, now)}
      </time>
      {streaming && (
        <span className="-order-1 flex">
          <span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          <span className="sr-only">Writing a Reply</span>
        </span>
      )}
      {tree.unseenFailure && (
        <span className="-order-1 flex">
          <span className="size-1.5 rounded-full bg-destructive" />
          <span className="sr-only">A Reply failed</span>
        </span>
      )}
    </span>
  )
}

interface RenameInputProps {
  tree: Tree
  onDone: (title: string | null) => void
}

function RenameInput({tree, onDone}: RenameInputProps) {
  const [title, setTitle] = useState(tree.title ?? '')
  // Enter and Escape unmount the input, which can also fire a blur.
  const done = useRef(false)

  function finish(result: string | null) {
    if (done.current) return
    done.current = true
    onDone(result)
  }

  function commit() {
    const trimmed = title.trim()
    finish(trimmed === '' || trimmed === tree.title ? null : trimmed)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') commit()

    if (event.key === 'Escape') finish(null)
  }

  return (
    <Input
      aria-label="Tree name"
      autoFocus
      maxLength={TREE_TITLE_MAX_LENGTH}
      className="h-8 bg-background px-2"
      value={title}
      onChange={event => setTitle(event.target.value)}
      onFocus={event => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}
