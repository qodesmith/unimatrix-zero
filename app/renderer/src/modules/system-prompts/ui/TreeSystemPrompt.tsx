import type {TreeSystemPrompt as Saved} from '@uz/contract/system-prompts'

import {Refusal, bridge, useCommand} from '#modules/bridge/main'
import {Button} from '#shadcn/ui/button'
import {Textarea} from '#shadcn/ui/textarea'
import {useId, useState} from 'react'

import {useDialogCommand} from '../dialog-command/use-dialog-command'
import {isTooLong} from '../too-long'
import {SaveToLibraryDialog} from './SaveToLibraryDialog'
import {TooLong} from './TooLong'

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
        className="max-h-96"
        value={text}
        onChange={event => setText(event.target.value)}
      />
      <TooLong text={text} />
      <p className="text-sm text-muted-foreground">
        Applies from this Tree’s next Reply.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={text === systemPrompt.text || isTooLong(text)}
          onClick={() =>
            void save.run({type: 'tree.set-system-prompt', treeId, text})
          }
        >
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isTooLong(text)}
          onClick={naming.ask}
        >
          Save to library…
        </Button>
      </div>
      <Refusal error={save.error} />
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
