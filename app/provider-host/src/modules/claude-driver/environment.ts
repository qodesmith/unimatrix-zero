import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * The environment `claude` runs in: the host's, minus anything that could
 * outrank the subscription, with its own configuration folder and its
 * self-updater off. The sign-in is kept under that folder even while the SDK
 * resumes a session from a temporary one; without it, a Mac's `claude` looks
 * for the sign-in under the temporary folder and isn't signed in.
 */
export function claudeEnvironment(base: NodeJS.ProcessEnv, configDir: string) {
  return {
    ...vendorEnvironment(base),
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: configDir,
    DISABLE_UPDATES: '1',
  }
}
