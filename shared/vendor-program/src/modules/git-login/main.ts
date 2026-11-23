export const NO_GIT_LOGIN =
  "No saved login for this host, and git can't ask for one inside the app. Install git if you have none, log in with it, then try again."

/** To stderr: `git` reads a helper's stdout as the login (ADR 0027). */
export const NO_LOGIN_HELPER = `!f() { if [ "$1" = get ]; then echo "${NO_GIT_LOGIN}" >&2; fi; }; f`
