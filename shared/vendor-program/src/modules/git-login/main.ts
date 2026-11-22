export const NO_GIT_LOGIN =
  "No saved login for this host, and git can't ask for one inside the app. Install git if you have none, log in with it, then try again."

/** To stderr: `git` reads a helper's stdout as the login (ADR 0027). */
export const NO_LOGIN_HELPER = `!f() { if [ "$1" = get ]; then echo "${NO_GIT_LOGIN}" >&2; fi; }; f`

/**
 * After the build's helper: Windows can't hold the empty value that clears the
 * list.
 */
export function withNoGitLogin(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const count = Number(base.GIT_CONFIG_COUNT ?? 0)

  return {
    ...base,
    GCM_INTERACTIVE: 'never',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: 'credential.helper',
    [`GIT_CONFIG_VALUE_${count}`]: NO_LOGIN_HELPER,
  }
}
