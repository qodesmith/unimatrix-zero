import type {TreeTools} from '@uz/contract/tools'
import type {Locator} from 'vitest/browser'

import {expect} from 'vitest'

export function toolSwitches(within: Locator) {
  const claude = within.getByRole('group', {name: 'Built in · Claude'})
  const chatgpt = within.getByRole('group', {name: 'Built in · ChatGPT'})

  return {
    webSearch: within.getByRole('switch', {name: 'Web search'}),
    claudeConnectors: within.getByRole('switch', {
      name: 'Claude account connectors',
    }),
    claudeBuiltInSkills: claude.getByRole('switch', {name: 'Built-in Skills'}),
    chatgptBuiltInSkills: chatgpt.getByRole('switch', {
      name: 'Built-in Skills',
    }),
    chatgptRemotePlugins: chatgpt.getByRole('switch', {name: 'Remote plugins'}),
  }
}

export async function expectSwitches(within: Locator, expected: TreeTools) {
  const switches = Object.entries(toolSwitches(within))

  await expect
    .poll(() =>
      Object.fromEntries(
        switches.map(([key, toggle]) => [
          key,
          toggle.query()?.getAttribute('aria-checked'),
        ])
      )
    )
    .toEqual(
      Object.fromEntries(
        Object.entries(expected).map(([key, on]) => [key, String(on)])
      )
    )
}
