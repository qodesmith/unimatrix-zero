/**
 * The data folder `bun run dev` gives this checkout, so each worktree keeps
 * its own sign-ins and vendor programs.
 */
import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/** A short hash of the checkout's path, which also spreads its dev ports. */
export function checkoutHash(root: string) {
  return createHash('sha256').update(root).digest('hex').slice(0, 8)
}

export function devDataFolderName(root: string, fake: boolean) {
  return `unimatrix-zero-dev-${checkoutHash(root)}${fake ? '-fake' : ''}`
}

/** Electron's `appData`, where the shell puts the dev data folder. */
function appData() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }

  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
}

/** This checkout's real-Provider dev data, as `bun run dev` left it. */
export function devUserData(root: string) {
  return path.join(appData(), devDataFolderName(root, false))
}
