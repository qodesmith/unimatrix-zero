import {SettingsProvider} from '#modules/settings/main'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain} from '../fake-main'
import {expectSwitches, toolSwitches} from '../switches'
import {ToolsSection} from './ToolsSection'

it('holds the Tools defaults under their reach note, and a flip saves them whole', async () => {
  const main = fakeMain()
  globalThis.window.uz = main

  const {locator} = await render(
    <SettingsProvider>
      <ToolsSection />
    </SettingsProvider>
  )

  await expect
    .element(
      page.getByText(
        'For new Trees. Each Tree changes its own in its Tree panel.'
      )
    )
    .toBeVisible()
  await expectSwitches(locator, {
    webSearch: true,
    claudeConnectors: false,
    claudeBuiltInSkills: false,
    chatgptBuiltInSkills: false,
    chatgptRemotePlugins: false,
  })

  await toolSwitches(locator).chatgptRemotePlugins.click()

  await expect.element(toolSwitches(locator).chatgptRemotePlugins).toBeChecked()
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
