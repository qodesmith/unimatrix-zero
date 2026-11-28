import {createHash} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

const DEV_FOLDER_PREFIX = 'unimatrix-zero-dev-'
const CLAUDE_KEYCHAIN = 'Claude Code-credentials'

function shortHash(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

export function checkoutHash(root: string) {
  return shortHash(root)
}

export function devDataFolderName(root: string, fake: boolean) {
  return `${DEV_FOLDER_PREFIX}${checkoutHash(root)}${fake ? '-fake' : ''}`
}

export function appData() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }

  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
}

export function devUserData(root: string) {
  return path.join(appData(), devDataFolderName(root, false))
}

/**
 * `claude` names its Keychain item after a hash of a non-default config folder.
 * The Keychain is macOS-only, so the path joins POSIX-style everywhere.
 */
function claudeKeychainOf(appDataPath: string, folder: string) {
  const configDir = path.posix.join(appDataPath, folder, 'providers', 'claude')

  return `${CLAUDE_KEYCHAIN}-${shortHash(configDir)}`
}

interface PruneInput {
  appDataPath: string
  checkouts: string[]
  appDataEntries: string[]
  keychainServices: string[]
}

export function planPrune({
  appDataPath,
  checkouts,
  appDataEntries,
  keychainServices,
}: PruneInput) {
  const kept = new Set(
    checkouts.flatMap(root => [
      devDataFolderName(root, false),
      devDataFolderName(root, true),
    ])
  )

  const devFolders = appDataEntries
    .filter(name => name.startsWith(DEV_FOLDER_PREFIX))
    .map(name => ({name, entry: claudeKeychainOf(appDataPath, name)}))

  const claudeEntries = new Set(
    keychainServices.filter(service =>
      service.startsWith(`${CLAUDE_KEYCHAIN}-`)
    )
  )

  const owned = new Set(devFolders.map(folder => folder.entry))

  return {
    folders: devFolders
      .filter(folder => !kept.has(folder.name))
      .map(({name, entry}) => ({
        name,
        keychain: claudeEntries.has(entry) ? entry : null,
      })),
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
