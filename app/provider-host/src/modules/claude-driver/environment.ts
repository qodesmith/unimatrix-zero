/**
 * Variables that would make a vendor program answer to something other than
 * the connected subscription, or read the user's own setup (ADR 0014).
 */
const STRIPPED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_']

/**
 * The environment `claude` runs in: the host's, minus anything that could
 * outrank the subscription, with its own configuration folder and its
 * self-updater off.
 */
export function claudeEnvironment(base: NodeJS.ProcessEnv, configDir: string) {
  const kept = Object.entries(base).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !STRIPPED_PREFIXES.some(prefix =>
        entry[0].toUpperCase().startsWith(prefix)
      )
  )

  return {
    ...Object.fromEntries(kept),
    CLAUDE_CONFIG_DIR: configDir,
    DISABLE_UPDATES: '1',
  }
}
