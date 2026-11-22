import {execFile} from 'node:child_process'

/**
 * Variables that would make a vendor program answer to something other than
 * the connected subscription, or read the user's own setup (ADR 0014).
 */
const STRIPPED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_']

/** Each driver adds its own folders to this. */
export function vendorEnvironment(base: NodeJS.ProcessEnv) {
  const kept = Object.entries(base).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !STRIPPED_PREFIXES.some(prefix =>
        entry[0].toUpperCase().startsWith(prefix)
      )
  )

  return Object.fromEntries(kept)
}

/**
 * Whether a Mac has Xcode or the Command Line Tools. `xcode-select -p` fails
 * where it has neither, and unlike the stubs in `/usr/bin` opens no dialog.
 */
export async function macHasDeveloperTools(env: NodeJS.ProcessEnv) {
  return new Promise<boolean>(resolve => {
    execFile('/usr/bin/xcode-select', ['-p'], {env}, error => {
      resolve(!error)
    })
  })
}

/**
 * `base`, with `DEVELOPER_DIR` naming the app's developer folder where the Mac
 * has no developer tools right now, so the stubs in `/usr/bin` run the app's
 * `xcrun` and never open the install dialog (ADR 0025). A Mac with its own
 * tools gets `base` as it is, and so does every other platform, where main
 * names no folder.
 */
export async function withDeveloperDir(
  base: NodeJS.ProcessEnv,
  developerDir: string | undefined,
  hasDeveloperTools: typeof macHasDeveloperTools
) {
  if (!developerDir || (await hasDeveloperTools(base))) return base

  return {...base, DEVELOPER_DIR: developerDir}
}
