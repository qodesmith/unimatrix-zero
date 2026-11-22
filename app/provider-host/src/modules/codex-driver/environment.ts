import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * `project_doc_max_bytes=0` keeps `AGENTS.md` out. A project's
 * `.codex/config.toml` loads only if `CODEX_HOME` trusts it, which the app
 * never writes. The `file` store keeps the sign-in in `CODEX_HOME` should
 * Codex's default move to the Keychain. Subagents stay off until the app can
 * show them.
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
 * Debian's `/etc/profile` drops the app's `git` from a login shell's `PATH`
 * (ADR 0026). A Mac needs the login shell to find the user's tools.
 */
export function codexArgs(platform: NodeJS.Platform) {
  return platform === 'linux'
    ? [...CODEX_ARGS, '-c', 'allow_login_shell=false']
    : CODEX_ARGS
}

export function codexEnvironment(base: NodeJS.ProcessEnv, codexHome: string) {
  return {...vendorEnvironment(base), CODEX_HOME: codexHome}
}
