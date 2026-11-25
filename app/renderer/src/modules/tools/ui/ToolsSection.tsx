import type {TreeTools} from '@uz/contract/tools'

import {Group, useSettings, useUpdateSettings} from '#modules/settings/main'
import {FieldDescription} from '#shadcn/ui/field'
import {useState} from 'react'

import {ToolSwitches} from './ToolSwitches'

export function ToolsSection() {
  const {toolDefaults} = useSettings()
  const update = useUpdateSettings()
  const [saved, setSaved] = useState(false)

  async function save(changes: Partial<TreeTools>) {
    setSaved(false)
    setSaved(await update({toolDefaults: {...toolDefaults, ...changes}}))
  }

  return (
    <Group
      legend="Defaults for new Trees"
      reachNote="A Tree you already made keeps its own switches. Change them in its Tree panel, from the ⋯ menu beside its name in the sidebar."
    >
      <ToolSwitches
        tools={toolDefaults}
        onChange={changes => void save(changes)}
      />
      {/* Always rendered, so a screen reader announces the text when it appears. */}
      <FieldDescription role="status">
        {saved && 'Saved for new Trees. Trees you already made kept their own.'}
      </FieldDescription>
    </Group>
  )
}
