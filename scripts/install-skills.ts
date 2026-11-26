import type {SkillsAddJsonResult} from './skills-types'

import {$} from 'bun'

// A later repo overwrites a skill of the same name, so the last one wins.
const SKILL_REPOS = ['mattpocock/skills', 'qodesmith/skills']

const installedNamesSet = new Set<string>()
const overwrittenNamesSet = new Set<string>()
const overwritten: Record<string, string> = {}

for (const repo of SKILL_REPOS) {
  const results: SkillsAddJsonResult[] =
    await $`bunx skills add ${repo} -a claude-code codex -s '*' -y --json`
      .env({...process.env, FORCE_COLOR: '1'})
      .json()

  const successSet = results.reduce<Set<string>>((acc, item) => {
    if ('name' in item && item.status === 'installed') {
      acc.add(item.name)
    }

    return acc
  }, new Set())

  const overwrittenSet = installedNamesSet.intersection(successSet)

  for (const name of successSet) {
    installedNamesSet.add(name)
  }

  for (const name of overwrittenSet) {
    overwritten[name] = repo
    overwrittenNamesSet.add(name)
  }
}
