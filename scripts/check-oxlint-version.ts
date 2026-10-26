/** Fails until someone has read the rule changes up to the installed oxlint. */
import path from 'node:path'
import {z} from 'zod'

import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')

const Versioned = z.looseObject({version: z.string()})
const Root = z.looseObject({'reviewed-oxlint-version': z.string()})

async function versionOf(packageJson: string) {
  return Versioned.parse(await Bun.file(path.join(root, packageJson)).json())
    .version
}

const reviewed = Root.parse(
  await Bun.file(path.join(root, 'package.json')).json()
)['reviewed-oxlint-version']

const installed = await versionOf('node_modules/oxlint/package.json')

const plugins = await versionOf(
  'tooling/node_modules/@oxlint/plugins/package.json'
)

const problems: string[] = []

if (installed !== reviewed) {
  problems.push(
    `oxlint is ${installed}, but package.json's reviewed-oxlint-version is ${reviewed}.`,
    `Read the rule changes in every oxlint release after ${reviewed}:`,
    `  gh release list -R oxc-project/oxc | grep oxlint_v`,
    `  gh release view oxlint_v<version> -R oxc-project/oxc`,
    `Turn on the new rules that fit in oxlint.config.ts, then set reviewed-oxlint-version to ${installed}.`
  )
}

if (plugins !== installed) {
  problems.push(
    `@oxlint/plugins is ${plugins} but oxlint is ${installed}. Pin tooling's @oxlint/plugins to ${installed}: the JS plugin API moves with oxlint.`
  )
}

finishCheck(
  problems,
  'oxlint is not the reviewed version:',
  `oxlint ${installed} is the reviewed version.`
)
