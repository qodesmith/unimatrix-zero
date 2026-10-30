import {Button} from '#modules/shadcn/main'
import {DEFAULT_SETTINGS, TEXT_SIZE} from '@uz/contract/settings'

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
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Text size</legend>
        <div className="flex items-center gap-3 text-sm">
          <input
            type="range"
            aria-label="Text size"
            className="accent-primary"
            min={TEXT_SIZE.min}
            max={TEXT_SIZE.max}
            step={TEXT_SIZE.step}
            value={settings.textSize}
            onChange={event =>
              void update({textSize: Number(event.target.value)})
            }
          />
          <output>{settings.textSize}px</output>
          <Button
            variant="outline"
            size="sm"
            disabled={settings.textSize === DEFAULT_SETTINGS.textSize}
            onClick={() => void update({textSize: DEFAULT_SETTINGS.textSize})}
          >
            Reset
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          ⌘/Ctrl + and − change it too, and ⌘/Ctrl 0 resets it.
        </p>
      </fieldset>
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
