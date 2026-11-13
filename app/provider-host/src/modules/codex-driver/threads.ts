import type {CompactionSettings} from '@uz/contract/settings'

export interface LoadedThread {
  id: string
  model: string
  /** The Compaction threshold Codex loaded it with, which it keeps. */
  threshold: CompactionSettings['threshold']
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
  path: string | null
}

export function configOf(threshold: CompactionSettings['threshold']) {
  return threshold === null ? {} : {model_auto_compact_token_limit: threshold}
}

export function loadThread(
  threads: Map<string, LoadedThread>,
  opened: {thread: {id: string; path: string | null}; model: string},
  turns: string[],
  threshold: CompactionSettings['threshold']
): LoadedThread {
  const thread = {
    id: opened.thread.id,
    model: opened.model,
    threshold,
    turns,
    path: opened.thread.path,
  }

  threads.set(thread.id, thread)

  return thread
}
