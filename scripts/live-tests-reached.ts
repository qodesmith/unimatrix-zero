// Runs under Electron as Node, as Vitest does: call it through `liveTestsReached`.
import type {Reached} from './changes-since.ts'

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
      // Vitest's default re-runs every test on any `package.json` or Vite
      // config. The gate's rules cover the pins and the lockfile, and Vitest
      // counts the root config and the global setup without a trigger.
      forceRerunTriggers: [],
    },
    {},
    {stdout: process.stderr}
  )

  try {
    const specs = await vitest.getRelevantTestSpecifications(['.live.test.ts'])

    // Slashes, as git names the changed files, on Windows too.
    return specs
      .map(spec =>
        path.relative(root, spec.moduleId).split(path.sep).join(path.posix.sep)
      )
      .toSorted()
  } finally {
    await vitest.close()
  }
}

const reached: Reached = []

for (const file of process.argv.slice(2)) {
  reached.push([file, await liveTestsImporting(file)])
}

process.stdout.write(JSON.stringify(reached))
