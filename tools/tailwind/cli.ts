/**
 * Shared CLI adapter for the tailwind tools — the one place the exit
 * contract lives:
 *
 * - Exit 0 — clean (an empty report prints nothing)
 * - Exit 1 — findings
 * - Exit 2 — usage error (unknown flag, missing flag value)
 *
 * Commands declare their flags and a run-function; parsing is strict, so a
 * typo'd flag is a usage error instead of silently running the wrong mode.
 */
import type {ParseArgsConfig} from 'node:util'

import {parseArgs} from 'node:util'

type FlagsConfig = NonNullable<ParseArgsConfig['options']>

type FlagValues<T extends FlagsConfig> = ReturnType<
  typeof parseArgs<{options: T; strict: true}>
>['values']

/* oxlint-disable no-console */
export async function runCli<T extends FlagsConfig>({
  flags,
  run,
}: {
  flags: T
  run: (
    values: FlagValues<T>
  ) => Promise<{report: string; hasFindings: boolean}>
}): Promise<void> {
  let values: FlagValues<T>

  try {
    values = parseArgs({options: flags, strict: true, allowPositionals: false})
      .values as FlagValues<T>
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 2
    return
  }

  const {report, hasFindings} = await run(values)

  if (report) console.log(report)
  process.exitCode = hasFindings ? 1 : 0
}
/* oxlint-enable no-console */
