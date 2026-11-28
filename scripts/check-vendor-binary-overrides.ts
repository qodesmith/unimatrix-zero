/**
 * Each optional dependency these packages list is a binary the app never
 * loads, so it must be overridden to the stub (ADR 0007, ADR 0008).
 */
import path from 'node:path'
import {z} from 'zod'

import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')
const stub = 'file:./tooling/no-vendor-binary'

interface Watched {
  name: string
  workspace: string
  allowed: 'any' | string[]
}

const WATCHED: Watched[] = [
  {
    name: '@anthropic-ai/claude-agent-sdk',
    workspace: 'app/provider-host',
    allowed: 'any',
  },
  {name: 'pdfjs-dist', workspace: 'app/extractor', allowed: []},
]

const Package = z.looseObject({
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
})

const Root = z.looseObject({
  overrides: z.record(z.string(), z.string()).default({}),
})

const {overrides} = Root.parse(
  await Bun.file(path.join(root, 'package.json')).json()
)

const problems: string[] = []
const stubbed = new Set<string>()
const checked: string[] = []

for (const {name, workspace, allowed} of WATCHED) {
  const installed = Package.parse(
    await Bun.file(
      path.join(root, workspace, 'node_modules', name, 'package.json')
    ).json()
  )

  checked.push(`${name} ${installed.version}`)

  for (const optional of Object.keys(installed.optionalDependencies)) {
    stubbed.add(optional)

    if (overrides[optional] !== stub) {
      problems.push(`  add "${optional}": "${stub}" (${name} lists it)`)
    }
  }

  if (allowed !== 'any') {
    for (const dependency of Object.keys(installed.dependencies)) {
      if (!allowed.includes(dependency)) {
        problems.push(
          `  ${name} ${installed.version} now depends on "${dependency}": check it has no native code, then add it to ${name}'s \`allowed\` in this script`
        )
      }
    }
  }
}

for (const [name, target] of Object.entries(overrides)) {
  if (target === stub && !stubbed.has(name)) {
    problems.push(`  remove "${name}" (no checked package lists it)`)
  }
}

finishCheck(
  problems,
  `package.json overrides don't match the binaries ${checked.join(' and ')} list (fix them, then bun install):`,
  `All ${stubbed.size} binaries that ${checked.join(' and ')} list are overridden.`
)
