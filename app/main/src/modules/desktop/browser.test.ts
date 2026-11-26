import {expect, it} from 'vitest'

import {openInLinuxBrowser} from './browser'

const FILE = '/home/me/.config/Unimatrix Zero/tree-folders/a/page.html'

const NO_BROWSER = /default browser/u

/** Answers each program by name, as the computer would; records each call. */
function computer(answers: Record<string, string | Error>) {
  const ran: string[][] = []

  async function run(program: string, args: string[]) {
    ran.push([program, ...args])

    const answer = answers[program] ?? new Error(`${program}: not found`)

    if (answer instanceof Error) throw answer

    return answer
  }

  return {run, ran}
}

it('opens the file in the default browser, by its desktop id, never in whatever app opens HTML', async () => {
  const {run, ran} = computer({
    'xdg-settings': 'firefox_firefox.desktop\n',
    'gtk-launch': '',
  })

  await openInLinuxBrowser(run, FILE)

  expect(ran).toEqual([
    ['xdg-settings', 'get', 'default-web-browser'],
    ['gtk-launch', 'firefox_firefox.desktop', FILE],
  ])
})

it.each([
  ['no default browser is set', ''],
  ['the answer isn’t a desktop id', 'firefox'],
  ['the answer could pass as an option', '--help.desktop'],
  ['the answer holds a path', '../evil.desktop'],
  ['xdg-settings fails', new Error('xdg-settings: not found')],
])('refuses, in plain words, when %s', async (_case, answer) => {
  const {run, ran} = computer({'xdg-settings': answer, 'gtk-launch': ''})

  await expect(openInLinuxBrowser(run, FILE)).rejects.toThrow(NO_BROWSER)
  expect(ran.map(([program]) => program)).toEqual(['xdg-settings'])
})

it('refuses, in plain words, when the browser can’t be launched', async () => {
  const {run} = computer({'xdg-settings': 'firefox.desktop'})

  await expect(openInLinuxBrowser(run, FILE)).rejects.toThrow(NO_BROWSER)
})
