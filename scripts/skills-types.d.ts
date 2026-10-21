///////////////////////////////////////////////////////////////
// TYPES IN THIS FILE ARE INFERRED FROM THE `skills` PACKAGE //
///////////////////////////////////////////////////////////////

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'

/*
  EXAMPLE:
  {
    name: "nuke-comments",
    status: "installed",
    source: "qodesmith/skills",
    ref: null,
    hash: "93318736aa621217f7df947aa63078dd3e2270ae23bc2a3389c09fbe9a45868a",
    path: "/Users/qodesmith/repos/unimatrix-zero/.agents/skills/nuke-comments",
    scope: "project",
    agents: [ "Claude Code", "Codex" ],
    mode: "symlink",
    security: {
      gen: "safe",
      socket: "0 alerts",
      snyk: "low",
      details: "https://skills.sh/qodesmith/skills",
    },
  }
*/
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
