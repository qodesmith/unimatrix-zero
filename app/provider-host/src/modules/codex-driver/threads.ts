export interface LoadedThread {
  id: string
  model: string
  /** The Compaction threshold Codex loaded it with, which it keeps. */
  threshold: number | null
  /** Oldest first: the turn it was opened at, then each one started here. */
  turns: string[]
  path: string | null
}

/** Codex's own default, with nothing in `config`, for a null threshold. */
export function configOf(threshold: number | null) {
  return threshold === null
    ? {}
    : {config: {model_auto_compact_token_limit: threshold}}
}
