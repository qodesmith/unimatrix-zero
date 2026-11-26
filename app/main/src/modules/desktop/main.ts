import type {Desktop} from '#modules/tree-files/main'
import type {Editor} from './editor'
import type {BrowserWindow} from 'electron'

import {app, dialog, nativeImage, shell} from 'electron'
import {execFile, spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import {promisify} from 'node:util'

import {openInLinuxBrowser} from './browser'
import {detectEditor} from './editor'

const execFileAsync = promisify(execFile)

/** Resolves once the program starts; it runs on after the app quits. */
async function launch(program: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.once('error', () => {
      reject(new Error('The app to open it with couldn’t be started.'))
    })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function runToEnd(program: string, args: string[]) {
  const {stdout} = await execFileAsync(program, args, {
    timeout: 10_000,
    windowsHide: true,
  })

  return stdout
}

/** The default browser, never whatever app opens HTML files. */
async function openInBrowser(file: string) {
  if (process.platform === 'linux') return openInLinuxBrowser(runToEnd, file)

  const browser = await app.getApplicationInfoForProtocol('https://')

  return process.platform === 'darwin'
    ? launch('open', ['-a', browser.path, file])
    : launch(browser.path, [file])
}

/** `window` is the app's, which dialogs and Quick Look belong to. */
export function createDesktop(window: () => BrowserWindow | null): Desktop {
  let editor: Editor | null | undefined

  function found() {
    editor ??= detectEditor({
      platform: process.platform,
      home: os.homedir(),
      env: process.env,
      exists: file => fs.existsSync(file),
    })

    return editor
  }

  return {
    platform: process.platform,
    editor: () => found()?.name ?? null,

    async openWithDefaultApp(file) {
      const failed = await shell.openPath(file)

      if (failed) throw new Error(`The file couldn’t be opened: ${failed}`)
    },

    openInBrowser,

    async openInEditor(file) {
      const {program, args} = found() ?? {}

      if (!program || !args) throw new Error('No editor was found.')

      await launch(program, [...args, file])
    },

    quickLook: (file, name) => window()?.previewFile(file, name),

    reveal: file => {
      shell.showItemInFolder(file)
    },

    async pickSaveFile(defaultName) {
      const parent = window()

      const options = {defaultPath: defaultName}

      const picked = await (parent
        ? dialog.showSaveDialog(parent, options)
        : dialog.showSaveDialog(options))

      return picked.canceled || !picked.filePath ? null : picked.filePath
    },

    async pickFolder() {
      const parent = window()

      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Save Here',
      }

      const picked = await (parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options))

      return picked.canceled ? null : (picked.filePaths[0] ?? null)
    },

    /**
     * MacOS only: on Windows a thumbnail can run another program's handler
     * inside the app.
     */
    async thumbnail(file) {
      if (process.platform !== 'darwin') return null

      const image = await nativeImage.createThumbnailFromPath(file, {
        width: 256,
        height: 256,
      })

      return image.isEmpty() ? null : image.toDataURL()
    },
  }
}
