import type {PromptDeleteState} from '../prompt-delete/machine'
import type {ReactNode} from 'react'

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

import {usePromptDelete} from '../prompt-delete/use-prompt-delete'
import {TooltipButton} from './TooltipButton'

interface ConfirmationProps {
  state: PromptDeleteState
  turnCount: number
  onConfirm: () => void
  onCancel: () => void
}

function Confirmation({
  state,
  turnCount,
  onConfirm,
  onCancel,
}: ConfirmationProps) {
  return (
    <AlertDialog
      open={state.status !== 'idle'}
      onOpenChange={open => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {turnCount} {turnCount === 1 ? 'Turn' : 'Turns'}?
          </AlertDialogTitle>
          <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {state.status === 'refused' && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={state.status === 'deleting'}
            onClick={onConfirm}
          >
            {state.status === 'deleting' ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface PromptBoxProps {
  promptId: string
  className: string
  children: ReactNode
}

/**
 * A Prompt's box, with its delete control drawn over its top-right corner, so
 * it shifts nothing on the canvas.
 */
export function PromptBox({promptId, className, children}: PromptBoxProps) {
  const {state, offered, turnCount, arm, cancel, confirm} =
    usePromptDelete(promptId)

  return (
    <div
      data-turn={promptId}
      className={cn('group/prompt relative', className)}
    >
      {children}
      {offered && (
        <div
          data-delete
          className={cn(
            'absolute top-1 right-1 z-10 transition-opacity',
            state.status === 'idle' &&
              'opacity-0 group-hover/prompt:opacity-100 focus-within:opacity-100'
          )}
        >
          <TooltipButton
            label="Delete this Prompt and everything below it"
            className="size-6 bg-card text-muted-foreground shadow-sm hover:text-destructive"
            onClick={arm}
          >
            <TrashIcon className="size-3.5" />
          </TooltipButton>
          <Confirmation
            state={state}
            turnCount={turnCount}
            onConfirm={confirm}
            onCancel={cancel}
          />
        </div>
      )}
    </div>
  )
}
