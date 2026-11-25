import {SettingsProvider} from '#modules/settings/main'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain} from '../fake-main'
import {expectSwitches, toolSwitches} from '../switches'
import {ToolsSection} from './ToolsSection'

it('holds the Tools defaults under a legend for new Trees, with a note that sends a Tree already made to its Tree panel, and a flip saves them whole and says the Trees already made kept theirs', async () => {
  const main = fakeMain()
  globalThis.window.uz = main

  const {locator} = await render(
    <SettingsProvider>
      <ToolsSection />
    </SettingsProvider>
  )

  const defaults = page.getByRole('group', {name: 'Defaults for new Trees'})

  await expect.element(defaults).toBeVisible()
  await expect
    .element(defaults)
    .toHaveAccessibleDescription(
      'A Tree you already made keeps its own switches. Change them in its Tree panel, from the ⋯ menu beside its name in the sidebar.'
    )
  await expect.element(page.getByRole('status')).toHaveTextContent('')
  await expectSwitches(locator, {
    webSearch: true,
    claudeConnectors: false,
    claudeBuiltInSkills: false,
    chatgptBuiltInSkills: false,
    chatgptRemotePlugins: false,
  })

  await toolSwitches(locator).chatgptRemotePlugins.click()

  await expect.element(toolSwitches(locator).chatgptRemotePlugins).toBeChecked()
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent(
      'Saved for new Trees. Trees you already made kept their own.'
    )
  expect(main.sent).toEqual([
    {
      type: 'settings.update',
      changes: {
        toolDefaults: {
          webSearch: true,
          claudeConnectors: false,
          claudeBuiltInSkills: false,
          chatgptBuiltInSkills: false,
          chatgptRemotePlugins: true,
        },
      },
    },
  ])
})

it('springs a Tools default back and leaves the status line empty when main refuses the flip', async () => {
  globalThis.window.uz = fakeMain({refusesSettings: true})

  const {locator} = await render(
    <SettingsProvider>
      <ToolsSection />
    </SettingsProvider>
  )

  await toolSwitches(locator).chatgptRemotePlugins.click()

  await expect
    .element(toolSwitches(locator).chatgptRemotePlugins)
    .not.toBeChecked()
  await expect.element(page.getByRole('status')).toHaveTextContent('')
})
