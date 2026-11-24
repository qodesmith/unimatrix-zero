import {Button} from '#shadcn/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#shadcn/ui/dialog'
import {Field, FieldLabel} from '#shadcn/ui/field'
import {Input} from '#shadcn/ui/input'
import {SYSTEM_PROMPT_NAME_MAX_LENGTH} from '@uz/contract/system-prompts'
import {useId, useState} from 'react'

import {Refusal} from './Refusal'

interface SaveToLibraryDialogProps {
  open: boolean
  running: boolean
  error: string | null
  onCancel: () => void
  onSave: (name: string) => void
}

export function SaveToLibraryDialog({
  open,
  onCancel,
  ...form
}: SaveToLibraryDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to library</DialogTitle>
          <DialogDescription>
            Adds this text to the library in Settings, under a name.
          </DialogDescription>
        </DialogHeader>
        <NameForm {...form} />
      </DialogContent>
    </Dialog>
  )
}

/** Mounts with the dialog, so each opening starts with no name. */
function NameForm({
  running,
  error,
  onSave,
}: Omit<SaveToLibraryDialogProps, 'open' | 'onCancel'>) {
  const nameId = useId()
  const [name, setName] = useState('')
  const trimmed = name.trim()

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={event => {
        event.preventDefault()

        if (trimmed !== '') onSave(trimmed)
      }}
    >
      <Field>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          id={nameId}
          autoFocus
          maxLength={SYSTEM_PROMPT_NAME_MAX_LENGTH}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </Field>
      <Refusal error={error} />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={running || trimmed === ''}>
          {running ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
