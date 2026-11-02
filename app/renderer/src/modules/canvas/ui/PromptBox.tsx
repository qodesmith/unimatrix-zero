import type {PromptDeleteState} from '../prompt-delete/machine'
import type {ReactNode} from 'react'

import {DeleteTreeDialog, useTreeDelete} from '#modules/trees/main'
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
import {cn} from 'cn'
import {TrashIcon} from 'lucide-react'

import {useCanvas} from '../canvas-context'
import {usePromptDelete} from '../prompt-delete/use-prompt-delete'
import {TooltipButton} from './TooltipButton'

interface ConfirmationProps {
  state: PromptDeleteState
  turnCount: number
  onConfirm: () => void
  onCancel: () => void
}

function confirmationView(state: PromptDeleteState) {
  switch (state.status) {
    case 'idle':
      return {open: false, deleting: false, error: null}
    case 'armed':
      return {open: true, deleting: false, error: null}
    case 'deleting':
      return {open: true, deleting: true, error: null}
    case 'refused':
      return {open: true, deleting: false, error: state.error}
    default:
      throw new Error('Unknown delete state.')
  }
}

function Confirmation({
  state,
  turnCount,
  onConfirm,
  onCancel,
}: ConfirmationProps) {
  const {open, deleting, error} = confirmationView(state)

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {turnCount} {turnCount === 1 ? 'Turn' : 'Turns'}?
          </AlertDialogTitle>
          <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface DeleteControlProps {
  label: string
  /** Shown only while the pointer or focus is on the Prompt. */
  idle: boolean
  onClick: () => void
  children: ReactNode
}

function DeleteControl({label, idle, onClick, children}: DeleteControlProps) {
  return (
    <div
      data-delete
      className={cn(
        'absolute top-1 right-1 z-10 transition-opacity',
        idle &&
          'opacity-0 group-hover/prompt:opacity-100 focus-within:opacity-100'
      )}
    >
      <TooltipButton
        label={label}
        className="size-6 bg-card text-muted-foreground shadow-sm hover:text-destructive"
        onClick={onClick}
      >
        <TrashIcon className="size-3.5" />
      </TooltipButton>
      {children}
    </div>
  )
}

/** Offered while its Replies stream too: main stops them first. */
function TreeDelete() {
  const {treeId} = useCanvas()
  const {ask, dialog} = useTreeDelete(treeId)

  return (
    <DeleteControl label="Delete this Tree" idle={!dialog.open} onClick={ask}>
      <DeleteTreeDialog {...dialog} />
    </DeleteControl>
  )
}

function PromptDelete({promptId}: {promptId: string}) {
  const {state, offered, turnCount, arm, cancel, confirm} =
    usePromptDelete(promptId)

  if (!offered) return null

  return (
    <DeleteControl
      label="Delete this Prompt and everything below it"
      idle={state.status === 'idle'}
      onClick={arm}
    >
      <Confirmation
        state={state}
        turnCount={turnCount}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </DeleteControl>
  )
}

interface PromptBoxProps {
  promptId: string
  className: string
  children: ReactNode
}

/**
 * A Prompt's box, with its delete control drawn over its top-right corner, so
 * it shifts nothing on the canvas. The root Prompt's deletes the Tree.
 */
export function PromptBox({promptId, className, children}: PromptBoxProps) {
  const {index} = useCanvas()
  const isRoot = index.promptById.get(promptId)?.parentReplyId === null

  return (
    <div
      data-turn={promptId}
      className={cn('group/prompt relative', className)}
    >
      {children}
      {isRoot ? <TreeDelete /> : <PromptDelete promptId={promptId} />}
    </div>
  )
}
