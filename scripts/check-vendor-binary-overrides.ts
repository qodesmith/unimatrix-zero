/**
 * The app downloads its own `claude` binaries (ADR 0008), so every
 * per-platform one the Agent SDK lists as an optional dependency must be
 * overridden to the stub.
 */
import path from 'node:path'
import {z} from 'zod'

import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')
const sdk = '@anthropic-ai/claude-agent-sdk'
const stub = 'file:./tooling/no-vendor-binary'

const Sdk = z.looseObject({
  version: z.string(),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
})

const Root = z.looseObject({
  overrides: z.record(z.string(), z.string()).default({}),
})

const installed = Sdk.parse(
  await Bun.file(
    path.join(root, 'app/provider-host/node_modules', sdk, 'package.json')
  ).json()
)

const {overrides} = Root.parse(
  await Bun.file(path.join(root, 'package.json')).json()
)

const listed = Object.keys(installed.optionalDependencies)

const overridden = Object.keys(overrides).filter(name =>
  name.startsWith(`${sdk}-`)
)

const problems: string[] = []

for (const name of listed) {
  if (overrides[name] !== stub) {
    problems.push(`  add "${name}": "${stub}"`)
  }
}

for (const name of overridden) {
  if (!listed.includes(name)) {
    problems.push(
      `  remove "${name}" (${sdk} ${installed.version} no longer lists it)`
    )
  }
}

finishCheck(
  problems,
  `package.json overrides don't match ${sdk} ${installed.version}'s optionalDependencies (fix them, then bun install):`,
  `All ${listed.length} ${sdk} platform binaries are overridden.`
)
