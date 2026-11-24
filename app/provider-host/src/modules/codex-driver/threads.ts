import type {ReplyRequest} from '@uz/contract/host'

export interface LoadedThread {
  id: string
  model: string
  /** The `config` Codex loaded it with, which it keeps; null for none. */
  config: ThreadConfig | null
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
  path: string | null
}

/**
 * Leaves out a key whose default is Codex's own: a resume without it goes back
 * to that default.
 */
export function configOf({
  compactionSettings: {threshold},
  tools,
}: Pick<ReplyRequest, 'compactionSettings' | 'tools'>) {
  return {
    ...(threshold === null ? {} : {model_auto_compact_token_limit: threshold}),
    ...(tools.webSearch ? {} : {web_search: 'disabled'}),
    'skills.bundled.enabled': tools.chatgptBuiltInSkills,
    // Remote plugins and the connectors that come with them.
    'features.plugins': tools.chatgptRemotePlugins,
    'features.apps': tools.chatgptRemotePlugins,
  }
}

export type ThreadConfig = ReturnType<typeof configOf>

export function loadThread(
  threads: Map<string, LoadedThread>,
  opened: {thread: {id: string; path: string | null}; model: string},
  turns: string[],
  config: ThreadConfig | null
): LoadedThread {
  const thread = {
    id: opened.thread.id,
    model: opened.model,
    config,
    turns,
    path: opened.thread.path,
  }

  threads.set(thread.id, thread)

  return thread
}
