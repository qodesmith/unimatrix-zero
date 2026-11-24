import type {Command} from '@uz/contract/commands'
import type {SystemPromptEntry} from '@uz/contract/system-prompts'

import {bridge} from '#modules/bridge/main'
import {Group, useSettings, useUpdateSettings} from '#modules/settings/main'
import {Badge} from '#shadcn/ui/badge'
import {Button} from '#shadcn/ui/button'
import {Field, FieldLabel} from '#shadcn/ui/field'
import {Input} from '#shadcn/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#shadcn/ui/select'
import {Textarea} from '#shadcn/ui/textarea'
import {
  SYSTEM_PROMPT_NAME_MAX_LENGTH,
  defaultEntry,
} from '@uz/contract/system-prompts'
import {useId, useState} from 'react'

import {useDialogCommand} from '../dialog-command/use-dialog-command'
import {isTooLong} from '../too-long'
import {useCommand} from '../use-command'
import {useLibrary} from '../use-library'
import {DeleteEntryDialog} from './DeleteEntryDialog'
import {Refusal} from './Refusal'
import {TooLong} from './TooLong'

export function SystemPromptsSection() {
  return (
    <>
      <DefaultForNewTrees />
      <Library />
    </>
  )
}

function DefaultForNewTrees() {
  const entries = useLibrary()
  const {defaultSystemPromptId} = useSettings()
  const update = useUpdateSettings()
  const picked = defaultEntry(entries, defaultSystemPromptId)

  return (
    <Group
      legend="Default for new Trees"
      note="New Trees start with a copy. Each Tree changes its own in its Tree panel."
    >
      <Select
        items={entries.map(entry => ({value: entry.id, label: entry.name}))}
        value={picked.id}
        onValueChange={id => {
          if (id !== null) void update({defaultSystemPromptId: id})
        }}
      >
        <SelectTrigger aria-label="Default for new Trees" className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {entries.map(entry => (
            <SelectItem key={entry.id} value={entry.id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Group>
  )
}

function Library() {
  const entries = useLibrary()

  return (
    <Group
      legend="Library"
      note="Each Tree keeps its own copy. Editing here changes no existing Tree."
    >
      <div className="flex flex-col gap-3">
        {entries.map(entry =>
          entry.preset ? (
            <PresetEntry key={entry.id} entry={entry} />
          ) : (
            <OwnEntry key={entry.id} entry={entry} />
          )
        )}
      </div>
    </Group>
  )
}

function duplicateOf(entry: SystemPromptEntry): Command {
  return {
    type: 'system-prompt.create',
    name: `Copy of ${entry.name}`.slice(0, SYSTEM_PROMPT_NAME_MAX_LENGTH),
    text: entry.text,
  }
}

function PresetEntry({entry}: {entry: SystemPromptEntry}) {
  const headingId = useId()
  const duplicate = useCommand()

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border p-4"
    >
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          {entry.name}
        </h3>
        <Badge variant="secondary">Preset</Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void duplicate.run(duplicateOf(entry))}
        >
          Duplicate
        </Button>
      </div>
      <p className="text-sm whitespace-pre-wrap text-muted-foreground">
        {entry.text}
      </p>
      <Refusal error={duplicate.error} />
    </section>
  )
}

function OwnEntry({entry}: {entry: SystemPromptEntry}) {
  const nameId = useId()
  const textId = useId()
  const [name, setName] = useState(entry.name)
  const [text, setText] = useState(entry.text)
  const command = useCommand()
  const deletion = useDialogCommand()
  const {defaultSystemPromptId} = useSettings()

  const unchanged = name.trim() === entry.name && text === entry.text

  return (
    <section
      aria-label={entry.name}
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <Field>
        <FieldLabel htmlFor={nameId}>Name</FieldLabel>
        <Input
          id={nameId}
          maxLength={SYSTEM_PROMPT_NAME_MAX_LENGTH}
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={textId}>Text</FieldLabel>
        <Textarea
          id={textId}
          className="max-h-80"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <TooLong text={text} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={unchanged || name.trim() === '' || isTooLong(text)}
          onClick={() =>
            void command.run({
              type: 'system-prompt.update',
              id: entry.id,
              name: name.trim(),
              text,
            })
          }
        >
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void command.run(duplicateOf(entry))}
        >
          Duplicate
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={deletion.ask}
        >
          Delete…
        </Button>
      </div>
      <Refusal error={command.error} />
      <DeleteEntryDialog
        name={entry.name}
        isDefault={entry.id === defaultSystemPromptId}
        open={deletion.open}
        running={deletion.running}
        error={deletion.error}
        onCancel={deletion.cancel}
        onConfirm={() =>
          deletion.confirm(async () =>
            bridge().send({type: 'system-prompt.delete', id: entry.id})
          )
        }
      />
    </section>
  )
}
