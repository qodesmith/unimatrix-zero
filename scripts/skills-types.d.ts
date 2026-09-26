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

export type SkillsLock = {
  version: number // currently 1
  skills: Record<string, SkillsLockEntry> // keyed by skill name, written sorted by name
}

export type SkillsLockEntry =
  // installed with `skills add <repo or path>`
  | {
      source: string // e.g. "qodesmith/skills"; a relative path like "./my-skills" for local sources
      sourceType: 'github' | 'gitlab' | 'git' | 'local'
      sourceUrl?: string
      ref?: string // omitted when no branch/tag was given
      skillPath?: string // e.g. "pr/SKILL.md"
      computedHash: string // sha256 of the skill folder's files
      subagents?: string[] // Eve only
    }
  // installed from a well-known source like `notion`
  | {
      source: string
      sourceType: 'well-known'
      sourceUrl: string
      computedHash: string
      wellKnownDigest: string
    }
  // added by `skills experimental_sync` from node_modules
  | {
      source: string // the npm package name
      sourceType: 'node_modules'
      computedHash: string
    }
