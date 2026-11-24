import {expect, it} from 'vitest'

import {withAppSections} from './section'

const folder =
  '/Users/someone/Library/Application Support/Unimatrix Zero/trees/019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b'

it('puts the app’s sections under the System prompt, naming the Tree’s folder and that edits elsewhere are not versioned and shared by every branch', () => {
  const sent = withAppSections('Answer in French.', folder)

  expect(sent.startsWith('Answer in French.\n\n# Your files')).toBe(true)
  expect(sent).toContain(`your working folder, ${folder}.`)
  expect(sent).toMatch(/anywhere else .* is not versioned/)
  expect(sent).toMatch(/every branch .* shares/)
})

it('tells the AI, whatever the System prompt, that the user may have no terminal, to keep their name out of commits, and not to promise work after a sign-in elsewhere', () => {
  for (const systemPrompt of ['', 'Answer in French.']) {
    const sent = withAppSections(systemPrompt, folder)

    expect(sent).toMatch(
      /may not be a developer.*no terminal.*step they can take without a terminal/s
    )
    expect(sent).toMatch(/real name or email unless they say so/)
    expect(sent).toMatch(/Don’t promise .* signs in elsewhere/)
  }
})

it('is the whole of what is sent when there is no System prompt, well under 400 tokens at three characters to a token', () => {
  const sent = withAppSections('', folder)

  expect(sent.startsWith('# Your files')).toBe(true)
  expect(sent.length / 3).toBeLessThan(400)
})
