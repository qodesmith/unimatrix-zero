import type {Tree} from '@uz/contract/trees'

import {Button} from '#shadcn/ui/button'
import {SidebarMenu} from '#shadcn/ui/sidebar'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'
import {PlusIcon} from 'lucide-react'
import {useState} from 'react'

import {DeleteTreeDialog} from './DeleteTreeDialog'
import {TreeRow} from './TreeRow'

interface TreeListProps {
  trees: Tree[]
  hasTrees: boolean | null
  openTreeId: string | null
  onOpen: (treeId: string) => void
  onRename: (treeId: string, title: string) => void
  onDelete: (treeId: string) => void
}

export function TreeList({
  trees,
  hasTrees,
  openTreeId,
  onOpen,
  onRename,
  onDelete,
}: TreeListProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (hasTrees === false) {
    return (
      <div className="px-4 py-1 text-xs text-muted-foreground">
        <p className="font-medium">Start a new Tree</p>
        <p>One conversation that can branch in any direction.</p>
      </div>
    )
  }

  return (
    <>
      <SidebarMenu className="px-2">
        {trees.map(tree => (
          <TreeRow
            key={tree.id}
            tree={tree}
            isOpen={tree.id === openTreeId}
            renaming={tree.id === renamingId}
            onOpen={() => onOpen(tree.id)}
            onStartRename={() => setRenamingId(tree.id)}
            onRenamed={title => {
              setRenamingId(null)

              if (title !== null) onRename(tree.id, title)
            }}
            onDelete={() => {
              if (tree.turnCount === 0) onDelete(tree.id)
              else setDeletingId(tree.id)
            }}
          />
        ))}
      </SidebarMenu>
      <DeleteTreeDialog
        open={deletingId !== null}
        onCancel={() => setDeletingId(null)}
        onConfirm={() => {
          if (deletingId !== null) onDelete(deletingId)

          setDeletingId(null)
        }}
      />
    </>
  )
}

export function NewTreeButton({onCreate}: {onCreate: () => void}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-xs" onClick={onCreate} />}
      >
        <PlusIcon />
        <span className="sr-only">New Tree</span>
      </TooltipTrigger>
      <TooltipContent side="right">New Tree</TooltipContent>
    </Tooltip>
  )
}
