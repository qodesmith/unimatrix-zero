/**
 * Prints, as JSON, the live tests in the checkout at the working folder that
 * import each file named on the command line, at any depth. It runs under
 * Electron as Node, as Vitest does; call it through `liveTestsReached`.
 */
import path from 'node:path'
import {createVitest} from 'vitest/node'

const root = process.cwd()

const vitest = await createVitest(
  'test',
  {root, watch: false, project: ['node'], reporters: []},
  {},
  {stdout: process.stderr}
)

const reached: [string, string[]][] = []

for (const file of process.argv.slice(2)) {
  vitest.config.related = [path.join(root, file)]

  const specs = await vitest.getRelevantTestSpecifications(['.live.test.ts'])

  reached.push([
    file,
    specs.map(spec => path.relative(root, spec.moduleId)).toSorted(),
  ])
}

await vitest.close()

process.stdout.write(JSON.stringify(reached))
