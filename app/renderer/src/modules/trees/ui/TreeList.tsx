import type {Tree} from '@uz/contract/trees'
import type {KeyboardEvent} from 'react'

import {
  Input,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#modules/shadcn/main'
import {TREE_TITLE_MAX_LENGTH} from '@uz/contract/trees'
import {PlusIcon} from 'lucide-react'
import {useRef, useState} from 'react'

interface TreeListProps {
  trees: Tree[]
  openTreeId: string | null
  onCreate: () => void
  onOpen: (treeId: string) => void
  onRename: (treeId: string, title: string) => void
}

export function TreeList({
  trees,
  openTreeId,
  onCreate,
  onOpen,
  onRename,
}: TreeListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)

  return (
    <SidebarGroup role="region" aria-label="Trees">
      <SidebarGroupLabel render={<h2 />}>Trees</SidebarGroupLabel>
      <SidebarGroupAction onClick={onCreate}>
        <PlusIcon />
        <span className="sr-only">New Tree</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        {trees.length === 0 ? (
          <div className="px-2 text-xs text-muted-foreground">
            <p className="font-medium">Start a new Tree</p>
            <p>One conversation that can branch in any direction.</p>
          </div>
        ) : (
          <SidebarMenu>
            {trees.map(tree => (
              <SidebarMenuItem key={tree.id}>
                {renamingId === tree.id ? (
                  <RenameInput
                    tree={tree}
                    onDone={title => {
                      setRenamingId(null)

                      if (title !== null) onRename(tree.id, title)
                    }}
                  />
                ) : (
                  <TreeButton
                    tree={tree}
                    isOpen={tree.id === openTreeId}
                    onOpen={() => onOpen(tree.id)}
                    onRename={() => setRenamingId(tree.id)}
                  />
                )}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function TreeTitle({tree}: {tree: Tree}) {
  return tree.title ?? <span className="italic">Untitled Tree</span>
}

interface TreeButtonProps {
  tree: Tree
  isOpen: boolean
  onOpen: () => void
  onRename: () => void
}

function TreeButton({tree, isOpen, onOpen, onRename}: TreeButtonProps) {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'F2') onRename()
  }

  return (
    <SidebarMenuButton
      isActive={isOpen}
      aria-current={isOpen ? 'page' : undefined}
      onClick={onOpen}
      onDoubleClick={onRename}
      onKeyDown={onKeyDown}
    >
      <span>
        <TreeTitle tree={tree} />
      </span>
    </SidebarMenuButton>
  )
}

interface RenameInputProps {
  tree: Tree
  /** The new title, or null when renaming was abandoned. */
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
      className="h-8 bg-background"
      value={title}
      onChange={event => setTitle(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}
