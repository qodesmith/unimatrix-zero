import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'

import {ReplyMarkdown} from './ReplyMarkdown'

it('shows HTML written into a Reply as text, never as markup', async () => {
  const screen = await render(
    <ReplyMarkdown
      text='Before <b>bold</b> <img src="https://example.com/x.png" onerror="alert(1)"> after'
      streaming={false}
    />
  )

  const root = screen.container
  expect(root.querySelector('b')).toBeNull()
  expect(root.querySelector('img')).toBeNull()
  await expect.element(screen.getByText(/Before/)).toBeVisible()
  expect(root.textContent).toContain('<b>bold</b>')
})

it('renders a link that opens outside the window, and blocks a javascript: one', async () => {
  const screen = await render(
    <ReplyMarkdown
      text="[Docs](https://example.com/docs) and [nope](javascript:alert(1))"
      streaming={false}
    />
  )

  const link = screen.getByRole('link', {name: 'Docs'})
  await expect.element(link).toHaveAttribute('href', 'https://example.com/docs')
  await expect.element(link).toHaveAttribute('target', '_blank')
  expect(screen.container.querySelector('a[href^="javascript"]')).toBeNull()
})

it('closes unfinished Markdown while the Reply is still being written', async () => {
  const screen = await render(
    <ReplyMarkdown text="Some **bold text" streaming />
  )

  await expect.element(screen.getByText('bold text')).toBeVisible()
  expect(
    screen.container.querySelector('[data-streamdown="strong"]')?.textContent
  ).toBe('bold text')
})

it('renders a KaTeX command that needs trust as an error, not markup', async () => {
  const screen = await render(
    <ReplyMarkdown
      text="$\href{https://example.com}{click}$"
      streaming={false}
    />
  )

  await expect
    .poll(() => screen.container.querySelector('.katex'))
    .not.toBeNull()
  expect(screen.container.querySelector('a')).toBeNull()
})
