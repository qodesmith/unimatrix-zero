import {Button} from '#shadcn/ui/button'
import {Kbd, KbdGroup} from '#shadcn/ui/kbd'
import {Slider} from '#shadcn/ui/slider'
import {DEFAULT_SETTINGS, FONT_SIZE} from '@uz/contract/settings'
import {useId} from 'react'

import {useSettings, useUpdateSettings} from '../use-settings'
import {Choice, Group, Toggle} from './Controls'

function ModShortcut({keyName}: {keyName: string}) {
  return (
    <KbdGroup>
      <Kbd>⌘/Ctrl</Kbd>
      <Kbd>{keyName}</Kbd>
    </KbdGroup>
  )
}

export function AppearanceSection() {
  const settings = useSettings()
  const update = useUpdateSettings()
  const fontSizeId = useId()

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
      <Group legend="Font size" legendId={fontSizeId}>
        <div className="flex items-center gap-3 text-sm">
          <Slider
            aria-labelledby={fontSizeId}
            className="w-32"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step={FONT_SIZE.step}
            value={[settings.fontSize]}
            onValueChange={value => {
              const [fontSize] = [value].flat()

              if (fontSize !== undefined) void update({fontSize})
            }}
          />
          <output>{settings.fontSize}px</output>
          <Button
            variant="outline"
            size="sm"
            disabled={settings.fontSize === DEFAULT_SETTINGS.fontSize}
            onClick={() => void update({fontSize: DEFAULT_SETTINGS.fontSize})}
          >
            Reset
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          <ModShortcut keyName="+" /> and <ModShortcut keyName="−" /> change it
          too, and <ModShortcut keyName="0" /> resets it.
        </p>
      </Group>
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
