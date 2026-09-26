import type {SkillsAddJsonResult} from './skills-types'

import {$} from 'bun'

// Order matters! Skills with the same name get overwritten by later repos.
const SKILL_REPOS = ['qodesmith/skills', 'mattpocock/skills']

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
