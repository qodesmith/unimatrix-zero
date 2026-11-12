export interface LoadedThread {
  id: string
  model: string
  /** The Compaction threshold Codex loaded it with, which it keeps. */
  threshold: number | null
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
  path: string | null
}

export function configOf(threshold: number | null) {
  return threshold === null ? {} : {model_auto_compact_token_limit: threshold}
}

export function loadThread(
  threads: Map<string, LoadedThread>,
  opened: {thread: {id: string; path: string | null}; model: string},
  turns: string[],
  threshold: number | null
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
