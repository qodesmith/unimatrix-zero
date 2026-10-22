import {vendorEnvironment} from '#modules/vendor-environment/main'

/**
 * What `codex app-server` runs with beside its own `CODEX_HOME`: its
 * self-updater off, and no `AGENTS.md` read into a Thread. A project's
 * `.codex/config.toml` loads only for a project trusted in `CODEX_HOME`'s
 * `config.toml`, which the app never writes.
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
