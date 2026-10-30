import {useSettings, useUpdateSettings} from '../use-settings'
import {Choice, Toggle} from './controls'

export function AppearanceSection() {
  const settings = useSettings()
  const update = useUpdateSettings()

  return (
    <>
      <Choice
        legend="Mode"
        value={settings.themeMode}
        options={[
          {value: 'system', label: 'System'},
          {value: 'light', label: 'Light'},
          {value: 'dark', label: 'Dark'},
        ]}
        onChange={themeMode => void update({themeMode})}
      />
      <Choice
        legend="Canvas orientation"
        value={settings.canvasOrientation}
        options={[
          {value: 'vertical', label: 'Vertical'},
          {value: 'horizontal', label: 'Horizontal'},
        ]}
        onChange={canvasOrientation => void update({canvasOrientation})}
      />
      <Toggle
        label="Context size meter"
        description="A thin bar on each Reply showing how full its Context window is."
        checked={settings.contextSizeMeter}
        onChange={contextSizeMeter => void update({contextSizeMeter})}
      />
      <Toggle
        label="Limit height of long messages"
        description="Long Prompts and Replies scroll inside a shorter box."
        checked={settings.limitTurnHeight}
        onChange={limitTurnHeight => void update({limitTurnHeight})}
      />
    </>
  )
}

export function ChatSection() {
  const settings = useSettings()
  const update = useUpdateSettings()

  return (
    <>
      <Choice
        legend="Send key"
        value={settings.sendKey}
        options={[
          {value: 'enter', label: 'Enter sends · Shift+Enter adds a new line'},
          {
            value: 'mod-enter',
            label: 'Enter adds a new line · ⌘/Ctrl+Enter sends',
          },
        ]}
        onChange={sendKey => void update({sendKey})}
      />
      <Toggle
        label="Re-read note"
        description="A note above the Input when a change, such as switching Provider, makes the AI read the whole Thread again."
        checked={settings.reReadNote}
        onChange={reReadNote => void update({reReadNote})}
      />
    </>
  )
}
