import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {Group} from './Controls'

it('sets a reach note flush under the legend of a group with one control', async () => {
  await render(
    <Group legend="Permissions" reachNote="Every Tree, from the next Reply.">
      <div>The one control</div>
    </Group>
  )

  const legend = page.getByText('Permissions').element()
  const note = page.getByText('Every Tree, from the next Reply.').element()

  expect(note.getBoundingClientRect().top).toBe(
    legend.getBoundingClientRect().bottom
  )
})
