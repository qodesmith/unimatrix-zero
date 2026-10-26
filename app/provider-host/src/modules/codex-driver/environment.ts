import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * `project_doc_max_bytes=0` keeps `AGENTS.md` out of a Thread. A project's
 * `.codex/config.toml` loads only if `CODEX_HOME`'s `config.toml` trusts it,
 * which the app never writes.
 */
export const CODEX_ARGS = [
  '-c',
  'check_for_update_on_startup=false',
  '-c',
  'project_doc_max_bytes=0',
]

/** The host's environment, minus anything that could outrank the subscription. */
export function codexEnvironment(base: NodeJS.ProcessEnv, codexHome: string) {
  return {...vendorEnvironment(base), CODEX_HOME: codexHome}
}
