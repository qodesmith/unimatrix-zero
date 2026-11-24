import {Group, useSettings, useUpdateSettings} from '#modules/settings/main'

import {ToolSwitches} from './ToolSwitches'

export function ToolsSection() {
  const {toolDefaults} = useSettings()
  const update = useUpdateSettings()

  return (
    <Group
      legend="Defaults"
      reachNote="For new Trees. Each Tree changes its own in its Tree panel."
    >
      <ToolSwitches
        tools={toolDefaults}
        onChange={changes =>
          void update({toolDefaults: {...toolDefaults, ...changes}})
        }
      />
    </Group>
  )
}
