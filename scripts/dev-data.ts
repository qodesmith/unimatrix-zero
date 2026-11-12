/**
 * The data folder `bun run dev` gives this checkout, so each worktree keeps
 * its own sign-ins and vendor programs.
 */
import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const PREFIX = 'unimatrix-zero-dev-'
const CLAUDE_KEYCHAIN = 'Claude Code-credentials'

function shortHash(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

/** A short hash of the checkout's path, which also spreads its dev ports. */
export function checkoutHash(root: string) {
  return shortHash(root)
}

export function devDataFolderName(root: string, fake: boolean) {
  return `${PREFIX}${checkoutHash(root)}${fake ? '-fake' : ''}`
}

/** Electron's `appData`, where the shell puts the dev data folder. */
export function appData() {
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

/**
 * The Keychain item `claude` keeps the sign-in of a dev folder's Claude config
 * folder under: `claude` hashes a config folder other than its default into
 * the name. `resume-config-swap-keychain` in `docs/provider-dependencies.md`.
 */
function claudeKeychainOf(appDataPath: string, folder: string) {
  const configDir = path.join(appDataPath, folder, 'providers', 'claude')

  return `${CLAUDE_KEYCHAIN}-${shortHash(configDir)}`
}

interface PruneInput {
  appDataPath: string
  checkouts: string[]
  /** The names in `appDataPath`. */
  folders: string[]
  /** The service of every Keychain item. */
  keychain: string[]
}

/**
 * The dev folders of checkouts that are gone, each with its Claude Keychain
 * entry, and the Claude entries no dev folder owns, which are left alone.
 */
export function planPrune({
  appDataPath,
  checkouts,
  folders,
  keychain,
}: PruneInput) {
  const kept = new Set(
    checkouts.flatMap(root => [
      devDataFolderName(root, false),
      devDataFolderName(root, true),
    ])
  )

  const devFolders = folders.filter(name => name.startsWith(PREFIX))

  const claudeEntries = new Set(
    keychain.filter(service => service.startsWith(`${CLAUDE_KEYCHAIN}-`))
  )

  const owned = new Set(
    devFolders.map(name => claudeKeychainOf(appDataPath, name))
  )

  return {
    folders: devFolders
      .filter(name => !kept.has(name))
      .map(name => {
        const entry = claudeKeychainOf(appDataPath, name)

        return {name, keychain: claudeEntries.has(entry) ? entry : null}
      }),
    unmatched: [...claudeEntries].filter(service => !owned.has(service)),
  }
}

export function worktreesIn(porcelain: string) {
  return porcelain
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length))
}

export function keychainServicesIn(dump: string) {
  return [...dump.matchAll(/^\s*"svce"<blob>="(.*)"$/gm)].map(
    match => match[1] ?? ''
  )
}
