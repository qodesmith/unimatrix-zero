import type {Bridge} from '@uz/contract/bridge'

import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {App} from './App'

const fakeBridge: Bridge = {
  send: (async command => ({
    ok: true,
    value: {nonce: command.nonce, receivedAt: '2026-10-19T12:00:00.000Z'},
  })) as Bridge['send'],
  subscribe: () => () => {},
  registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
}

it('shows the pong main sends back', async () => {
  globalThis.window.uz = fakeBridge
  await render(<App />)
  await page.getByRole('button', {name: 'Ping main'}).click()
  await expect
    .element(page.getByText(/pong · .* · 2026-10-19T12:00:00.000Z/))
    .toBeVisible()
})
