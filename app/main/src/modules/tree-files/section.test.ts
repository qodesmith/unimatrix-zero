import {expect, it} from 'vitest'

import {withFilesSection} from './section'

const folder =
  '/Users/someone/Library/Application Support/Unimatrix Zero/trees/019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b'

it('puts the app’s section under the System prompt, naming the Tree’s folder and that edits elsewhere are not versioned and shared by every branch', () => {
  const sent = withFilesSection('Answer in French.', folder)

  expect(sent.startsWith('Answer in French.\n\n')).toBe(true)
  expect(sent).toContain(`your working folder, ${folder}.`)
  expect(sent).toMatch(/anywhere else .* is not versioned/)
  expect(sent).toMatch(/every branch .* shares/)
})

it('is the whole of what is sent when there is no System prompt, well under 400 tokens at three characters to a token', () => {
  const sent = withFilesSection('', folder)

  expect(sent.startsWith('# Your files')).toBe(true)
  expect(sent.length / 3).toBeLessThan(400)
})
