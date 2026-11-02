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

interface DeleteTreeDialogProps {
  open: boolean
  linkedFolder?: boolean
  /** Main has been asked and hasn't answered yet. */
  deleting?: boolean
  /** Main's refusal, shown until the user confirms again or cancels. */
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** Asked before deleting a Tree, from its sidebar row or its root Prompt. */
export function DeleteTreeDialog({
  open,
  linkedFolder = false,
  deleting = false,
  error = null,
  onCancel,
  onConfirm,
}: DeleteTreeDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Tree?</AlertDialogTitle>
          <AlertDialogDescription>
            This Tree will be permanently deleted. This can’t be undone.
            {linkedFolder && (
              <> The linked folder stays where it is, untouched.</>
            )}
          </AlertDialogDescription>
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
