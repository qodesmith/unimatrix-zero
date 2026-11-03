import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'

import {DiagramError} from './DiagramError'

it('keeps the failed diagram’s code folded until Show code is clicked', async () => {
  const screen = await render(
    <DiagramError
      chart="flowchart LR\n  A --> B"
      error="Parse error"
      retry={() => undefined}
    />
  )
  const code = screen.getByText(/flowchart LR/)

  await expect.element(screen.getByText(/Parse error/)).toBeVisible()
  await expect.element(code).not.toBeInTheDocument()

  await screen.getByRole('button', {name: 'Show code'}).click()
  await expect.element(code).toBeVisible()
})
