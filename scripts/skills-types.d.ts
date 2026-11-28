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
      agents: string[]
      mode: 'symlink' | 'copy'
      security: {
        gen?: RiskLevel
        socket?: string
        snyk?: RiskLevel
        details?: string
      } | null
    }
  | {name: string; status: 'failed'; error: string}
  | {name: string; status: 'skipped'; reason: string}
  | {status: 'failed'; error: string}
