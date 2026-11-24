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

import {Refusal} from './Refusal'

interface DeleteEntryDialogProps {
  name: string
  isDefault: boolean
  open: boolean
  running: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteEntryDialog({
  name,
  isDefault,
  open,
  running,
  error,
  onCancel,
  onConfirm,
}: DeleteEntryDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete System prompt?</AlertDialogTitle>
          <AlertDialogDescription>
            “{name}” leaves the library. Trees that use it keep their own copy.
            {isDefault && <> New Trees will start with Default.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Refusal error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={running}
            onClick={onConfirm}
          >
            {running ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
