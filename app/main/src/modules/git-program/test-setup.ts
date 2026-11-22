import type {Machine} from '#modules/vendor-programs/main'
import type {TestProject} from 'vitest/node'

import {gitTargetFor} from '#modules/vendor-programs/main'
import {getProgramReady, programOf} from '@uz/vendor-program'
import path from 'node:path'

declare module 'vitest' {
  export interface ProvidedContext {
    /** The manifest's `git` for this machine, by its full path. */
    gitProgram: string
    /** The machine the tests run on, with the cache as its data folder. */
    machine: Machine
  }
}

const cache = path.resolve(
  import.meta.dirname,
  '../../../../../node_modules/.cache/uz-test'
)

/**
 * Downloads the `git` the app runs on this machine, once, so the tests run the
 * same build the app does on every CI platform.
 */
export async function setup(project: TestProject) {
  const machine: Machine = {
    userData: cache,
    platform: process.platform,
    arch: process.arch,
  }

  const target = gitTargetFor(machine)

  if (!target) {
    throw new Error(
      `The manifest has no git for ${machine.platform}-${machine.arch}.`
    )
  }

  const ready = getProgramReady(target, {signal: new AbortController().signal})

  try {
    for await (const _progress of ready);
  } catch (error) {
    // Vitest fails to print an error thrown here, so its reason goes first.
    process.stderr.write(`The tests' git isn't ready: ${String(error)}\n`)
    throw error
  }

  project.provide('gitProgram', programOf(target))
  project.provide('machine', machine)
}
