/** One wording everywhere: on Windows it reaches the user's own `git` too. */
export const NO_GIT_SIGN_IN =
  "No saved login for this host, and git can't ask for one inside the app. Install git if you have none, sign in with it, then try again."

/**
 * A credential helper that only prints the line, and only when `git` wants a
 * login. To stderr: `git` reads a helper's stdout as the login (ADR 0027).
 */
export const NO_SIGN_IN_HELPER = `!f() { if [ "$1" = get ]; then echo "${NO_GIT_SIGN_IN}" >&2; fi; }; f`

/**
 * Windows has no script to set these for the one call, so they reach the
 * user's own `git` too. The helper is added after the build's own, since
 * Windows can't hold the empty value that clears the list: a saved login
 * still works, and only asking for one is off (ADR 0027).
 */
export function withNoGitSignIn(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const count = Number(base.GIT_CONFIG_COUNT ?? 0)

  return {
    ...base,
    GCM_INTERACTIVE: 'never',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'credential.helper',
    [`GIT_CONFIG_VALUE_${count}`]: NO_SIGN_IN_HELPER,
  }
}
