import type {Tree} from '@uz/contract/trees'

import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain, savedTree} from '../fake-main'
import {expectSwitches, toolSwitches} from '../switches'
import {TreeToolsSection} from './TreeToolsSection'

async function renderSection(tree: Tree, saved: Tree[]) {
  const main = fakeMain({trees: saved})
  globalThis.window.uz = main

  await render(<TreeToolsSection treeId={tree.id} tools={tree.tools} />)

  return main
}

function section() {
  return page.getByRole('region', {name: 'Tools'})
}

it('shows the Tree’s own Tools and when they apply, and a flip sends that one switch alone', async () => {
  const tree = savedTree({
    tools: {
      webSearch: true,
      claudeConnectors: true,
      claudeBuiltInSkills: false,
      chatgptBuiltInSkills: false,
      chatgptRemotePlugins: true,
    },
  })

  const main = await renderSection(tree, [tree])

  await expectSwitches(section(), {
    webSearch: true,
    claudeConnectors: true,
    claudeBuiltInSkills: false,
    chatgptBuiltInSkills: false,
    chatgptRemotePlugins: true,
  })
  await expect
    .element(section().getByText('Applies from this Tree’s next Reply.'))
    .toBeVisible()

  await toolSwitches(section()).chatgptBuiltInSkills.click()

  await expect
    .poll(() => main.sent)
    .toEqual([
      {
        type: 'tree.set-tools',
        treeId: tree.id,
        changes: {chatgptBuiltInSkills: true},
      },
    ])
})

it('says why main refused a flip, and leaves the switch as it was', async () => {
  await renderSection(savedTree(), [])

  await toolSwitches(section()).webSearch.click()

  await expect.element(section().getByRole('alert')).toHaveTextContent('Gone')
  await expect.element(toolSwitches(section()).webSearch).toBeChecked()
})
