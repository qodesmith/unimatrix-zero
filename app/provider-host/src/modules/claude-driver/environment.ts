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

/**
 * A Reply waits out a lost connection for about 3 hours instead of 3 to 5
 * minutes, and still fails at once at a usage limit instead of waiting there
 * until it resets. `claude` reads a cap of `0` as none, so the cap is 1 ms.
 */
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
