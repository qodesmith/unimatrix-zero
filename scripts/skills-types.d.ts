// Inferred from the `skills` package's output.

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

export type SkillsAddJsonResult =
  | {
      name: string
      status: 'installed'
      source: string
      ref: string | null
      hash: string | null
      path: string
      scope: 'project' | 'global'
      agents: string[] // display names, e.g. "Claude Code", not ids like "claude-code"
      mode: 'symlink' | 'copy'
      security: {
        gen?: RiskLevel
        socket?: string // e.g. "0 alerts", "1 alert"
        snyk?: RiskLevel
        details?: string
      } | null
    }

  // one of the skills failed to install
  | {name: string; status: 'failed'; error: string}

  // a skill named with -s doesn't exist in the repo
  | {name: string; status: 'skipped'; reason: string}

  // the whole command failed, e.g. clone error or missing -y
  | {status: 'failed'; error: string}
