import type {TreeSystemPrompt as Saved} from '@uz/contract/system-prompts'

import {bridge} from '#modules/bridge/main'
import {Button} from '#shadcn/ui/button'
import {Textarea} from '#shadcn/ui/textarea'
import {SYSTEM_PROMPT_MAX_LENGTH} from '@uz/contract/system-prompts'
import {useId, useState} from 'react'

import {useDialogCommand} from '../dialog-command/use-dialog-command'
import {useCommand} from '../use-command'
import {SaveToLibraryDialog} from './SaveToLibraryDialog'

interface TreeSystemPromptProps {
  treeId: string
  systemPrompt: Saved
}

/** The Tree panel's own copy, which changes no library entry. */
export function TreeSystemPrompt({
  treeId,
  systemPrompt,
}: TreeSystemPromptProps) {
  const headingId = useId()
  const [text, setText] = useState(systemPrompt.text)
  const save = useCommand()
  const naming = useDialogCommand()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-sm font-medium">
        System prompt
      </h3>
      <Textarea
        aria-labelledby={headingId}
        maxLength={SYSTEM_PROMPT_MAX_LENGTH}
        className="max-h-96"
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        Applies from this Tree’s next Reply.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={text === systemPrompt.text}
          onClick={() =>
            void save.run({type: 'tree.set-system-prompt', treeId, text})
          }
        >
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={naming.ask}>
          Save to library…
        </Button>
      </div>
      {save.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {save.error}
        </p>
      )}
      <SaveToLibraryDialog
        open={naming.open}
        running={naming.running}
        error={naming.error}
        onCancel={naming.cancel}
        onSave={name =>
          naming.confirm(async () =>
            bridge().send({type: 'system-prompt.create', name, text})
          )
        }
      />
    </section>
  )
}
