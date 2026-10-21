import type {Tree} from '@uz/contract/trees'
import type {KeyboardEvent} from 'react'

import {Button} from '#modules/shadcn/main'
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
    <section aria-label="Trees" className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide uppercase">Trees</h2>
        <Button size="sm" variant="ghost" onClick={onCreate}>
          New Tree
        </Button>
      </header>
      {trees.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium">Start a new Tree</p>
          <p>One conversation that can branch in any direction.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {trees.map(tree => (
            <li key={tree.id}>
              {renamingId === tree.id ? (
                <RenameInput
                  tree={tree}
                  onDone={title => {
                    setRenamingId(null)

                    if (title !== null) onRename(tree.id, title)
                  }}
                />
              ) : (
                <TreeRow
                  tree={tree}
                  isOpen={tree.id === openTreeId}
                  onOpen={() => onOpen(tree.id)}
                  onRename={() => setRenamingId(tree.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function TreeTitle({tree}: {tree: Tree}) {
  return tree.title ?? <span className="italic">Untitled Tree</span>
}

interface TreeRowProps {
  tree: Tree
  isOpen: boolean
  onOpen: () => void
  onRename: () => void
}

function TreeRow({tree, isOpen, onOpen, onRename}: TreeRowProps) {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'F2') onRename()
  }

  return (
    <button
      type="button"
      aria-current={isOpen ? 'page' : undefined}
      className="w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium"
      onClick={onOpen}
      onDoubleClick={onRename}
      onKeyDown={onKeyDown}
    >
      <TreeTitle tree={tree} />
    </button>
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
    <input
      aria-label="Tree name"
      autoFocus
      maxLength={200}
      className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
      value={title}
      onChange={event => setTitle(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}
