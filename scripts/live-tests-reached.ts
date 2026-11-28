// Runs under Electron as Node, as Vitest does: call it through `liveTestsReached`.
import path from 'node:path'
import {createVitest} from 'vitest/node'

const root = process.cwd()

async function liveTestsImporting(file: string) {
  const vitest = await createVitest(
    'test',
    {
      root,
      watch: false,
      project: ['node'],
      reporters: [],
      related: [path.join(root, file)],
      // Vitest's default also re-runs every test on any `package.json`. The
      // gate's own rules already cover the pins and the lockfile.
      forceRerunTriggers: ['**/{vitest,vite}.config.*'],
    },
    {},
    {stdout: process.stderr}
  )

  try {
    const specs = await vitest.getRelevantTestSpecifications(['.live.test.ts'])

    return specs.map(spec => path.relative(root, spec.moduleId)).toSorted()
  } finally {
    await vitest.close()
  }
}

const reached: [string, string[]][] = []

for (const file of process.argv.slice(2)) {
  reached.push([file, await liveTestsImporting(file)])
}

process.stdout.write(JSON.stringify(reached))
