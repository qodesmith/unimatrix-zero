import {Group, useSettings, useUpdateSettings} from '#modules/settings/main'
import {FieldDescription} from '#shadcn/ui/field'
import {useState} from 'react'

import {ToolSwitches} from './ToolSwitches'

export function ToolsSection() {
  const {toolDefaults} = useSettings()
  const update = useUpdateSettings()
  const [flipped, setFlipped] = useState(false)

  return (
    <Group
      legend="Defaults for new Trees"
      reachNote="A Tree you already made keeps its own switches. Change them in its Tree panel, from the ⋯ menu beside its name in the sidebar."
    >
      <ToolSwitches
        tools={toolDefaults}
        onChange={changes => {
          setFlipped(true)
          void update({toolDefaults: {...toolDefaults, ...changes}})
        }}
      />
      {/* Always rendered, so a screen reader announces the text when it appears. */}
      <FieldDescription role="status">
        {flipped &&
          'Saved for new Trees. Trees you already made kept their own.'}
      </FieldDescription>
    </Group>
  )
}
