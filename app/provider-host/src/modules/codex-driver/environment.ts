import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * `project_doc_max_bytes=0` keeps `AGENTS.md` out of a Thread. A project's
 * `.codex/config.toml` loads only if `CODEX_HOME`'s `config.toml` trusts it,
 * which the app never writes. `cli_auth_credentials_store="file"` keeps the
 * sign-in in `CODEX_HOME`, inside the data folder, should Codex's default move
 * to the Keychain. `features.multi_agent=false` leaves Subagents out until the
 * app can show them.
 */
const CODEX_ARGS = [
  '-c',
  'check_for_update_on_startup=false',
  '-c',
  'project_doc_max_bytes=0',
  '-c',
  'cli_auth_credentials_store="file"',
  '-c',
  'features.multi_agent=false',
]

/**
 * On Linux Codex runs each command in a login shell unless told not to, and
 * Debian's `/etc/profile` sets `PATH` outright, dropping the folder of the
 * app's own `git` (ADR 0026). On a Mac the login shell is how Codex finds the
 * user's own tools, and on Windows it uses none.
 */
export function codexArgs(platform: NodeJS.Platform) {
  return platform === 'linux'
    ? [...CODEX_ARGS, '-c', 'allow_login_shell=false']
    : CODEX_ARGS
}

/** The host's environment, minus anything that could outrank the subscription. */
export function codexEnvironment(base: NodeJS.ProcessEnv, codexHome: string) {
  return {...vendorEnvironment(base), CODEX_HOME: codexHome}
}
