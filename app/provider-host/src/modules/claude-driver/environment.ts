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
