import {expect, it} from 'vitest'

import {detectEditor} from './editor'

function lookup(
  platform: NodeJS.Platform,
  present: string[],
  env: NodeJS.ProcessEnv = {}
) {
  return {
    platform,
    home: '/Users/me',
    env,
    exists: (file: string) => present.includes(file),
  }
}

it('finds the first editor macOS has in either Applications folder, and opens files with it there', () => {
  expect(
    detectEditor(
      lookup('darwin', [
        '/Applications/Sublime Text.app',
        '/Users/me/Applications/Cursor.app',
      ])
    )
  ).toEqual({
    name: 'Cursor',
    program: 'open',
    args: ['-a', '/Users/me/Applications/Cursor.app'],
  })
})

it('finds Visual Studio Code where Windows installs it', () => {
  const program = String.raw`C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe`

  expect(
    detectEditor(
      lookup('win32', [program], {
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        ProgramFiles: String.raw`C:\Program Files`,
      })
    )
  ).toEqual({name: 'Visual Studio Code', program, args: []})
})

it('finds an editor on the Linux PATH', () => {
  expect(
    detectEditor(
      lookup('linux', ['/usr/local/bin/zed', '/opt/bin/subl'], {
        PATH: '/usr/bin:/opt/bin:/usr/local/bin',
      })
    )
  ).toEqual({name: 'Zed', program: '/usr/local/bin/zed', args: []})
})

it('finds none on a computer with no editor it knows', () => {
  expect(detectEditor(lookup('darwin', []))).toBeNull()
  expect(detectEditor(lookup('win32', []))).toBeNull()
  expect(detectEditor(lookup('linux', [], {PATH: '/usr/bin'}))).toBeNull()
})
