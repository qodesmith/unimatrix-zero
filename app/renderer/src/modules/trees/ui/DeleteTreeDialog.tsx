import type {Tree} from '@uz/contract/trees'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#shadcn/ui/alert-dialog'
import {useState} from 'react'

import {treeName} from '../tree-name'

interface DeleteTreeDialogProps {
  /** The Tree to ask about; null while closed. */
  tree: Tree | null
  onCancel: () => void
  onConfirm: (tree: Tree) => void
}

export function DeleteTreeDialog({
  tree,
  onCancel,
  onConfirm,
}: DeleteTreeDialogProps) {
  // Kept through the closing animation, so the text doesn't empty as it fades.
  const [shown, setShown] = useState(tree)

  if (tree !== null && tree !== shown) setShown(tree)

  const turns = shown?.turnCount ?? 0

  return (
    <AlertDialog
      open={tree !== null}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “{shown ? treeName(shown) : ''}”?
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>
              {turns === 1
                ? '1 Turn is deleted for good.'
                : `${turns} Turns are deleted for good.`}
            </p>
            <p>A linked folder stays where it is, untouched.</p>
            <p>This can’t be undone.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (tree) onConfirm(tree)
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
