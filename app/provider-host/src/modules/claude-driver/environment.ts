import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * The sign-in stays under `configDir` while the SDK resumes from a temporary
 * folder; without it, a Mac's `claude` looks there and isn't signed in.
 */
export function claudeEnvironment(base: NodeJS.ProcessEnv, configDir: string) {
  return {
    ...vendorEnvironment(base),
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: configDir,
    DISABLE_UPDATES: '1',
  }
}

/** `claude` reads a usage-limit wait of `0` as no cap, so the cap is 1 ms. */
export function claudeReplyEnvironment(
  base: NodeJS.ProcessEnv,
  configDir: string
) {
  return {
    ...claudeEnvironment(base, configDir),
    CLAUDE_CODE_RETRY_WATCHDOG: '1',
    CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS: '1',
  }
}
