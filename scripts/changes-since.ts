import type {Cause, Since} from './provider-checks-result.ts'

import {execFile} from 'node:child_process'
import path from 'node:path'
import {promisify} from 'node:util'
import {z} from 'zod'

import {runElectronAsNode} from './electron-as-node.ts'
import {isLiveTest, isRecording} from './recordings.ts'
import {CODEX_PROTOCOL, HOST_PACKAGE, MANIFEST} from './vendor-pins.ts'

const LOCKFILE = 'bun.lock'

const REACHED_SCRIPT = path.join(import.meta.dirname, 'live-tests-reached.ts')

const Reached = z.array(z.tuple([z.string(), z.array(z.string())]))

export type Reached = z.infer<typeof Reached>

const MAX_BUFFER = 64 * 1024 * 1024

const execFileAsync = promisify(execFile)

async function git(root: string, ...args: string[]) {
  const {stdout} = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: MAX_BUFFER,
  })

  return stdout
}

const GitExit = z.object({code: z.number()})

async function isAncestor(root: string, from: string, head: string) {
  try {
    await git(root, 'merge-base', '--is-ancestor', from, head)

    return true
  } catch (error) {
    // 1 is "not an ancestor", and 128 a commit the checkout doesn't have.
    const code = GitExit.safeParse(error).data?.code

    if (code === 1 || code === 128) return false

    throw error
  }
}

/** The files changed from `from` to `head`, when `from` is in `head`'s history. */
export async function filesChangedSince(
  root: string,
  from: string,
  head: string
) {
  if (!(await isAncestor(root, from, head))) return {ancestor: false} as const

  const changed = await git(
    root,
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    from,
    head
  )

  return {
    ancestor: true,
    files: changed.split('\0').filter(Boolean).toSorted(),
  } as const
}

/** The live tests in the checkout at `root` that import each of `files`. */
export function liveTestsReached(root: string, files: string[]) {
  const {status, stdout, stderr} = runElectronAsNode(
    [REACHED_SCRIPT, ...files],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    }
  )

  if (status !== 0) {
    throw new Error(`live-tests-reached exited ${status}: ${String(stderr)}`)
  }

  return new Map(
    Reached.parse(JSON.parse(String(stdout))).filter(
      ([, liveTests]) => liveTests.length > 0
    )
  )
}

const RULES: [matches: (file: string) => boolean, why: string][] = [
  [isLiveTest, 'a live test'],
  [isRecording, 'a recording'],
  [
    file => file.startsWith(`${CODEX_PROTOCOL}/`),
    'checked by the Codex live test',
  ],
  [file => file === MANIFEST || file === HOST_PACKAGE, 'a vendor pin'],
  [file => file === LOCKFILE, 'the lockfile'],
]

function whyOf(file: string, reached: string[]) {
  const why = RULES.find(([matches]) => matches(file))?.[1]

  if (why !== undefined) return why

  return reached.length > 0 ? `imported by ${reached.join(', ')}` : null
}

/** What changed from a result's commit to `head`, the checkout at `root`. */
export async function changesSince(
  root: string,
  from: string,
  head: string
): Promise<Since> {
  const since = await filesChangedSince(root, from, head)

  if (!since.ancestor) return since

  return {
    ancestor: true,
    causes: reRunCauses(since.files, liveTestsReached(root, since.files)),
  }
}

/**
 * The changed files that need a new live run. `reached` maps a file to the
 * live tests that import it, at any depth.
 */
export function reRunCauses(
  changed: string[],
  reached: Map<string, string[]>
): Cause[] {
  return changed.flatMap(file => {
    const why = whyOf(file, reached.get(file) ?? [])

    return why === null ? [] : [{file, why}]
  })
}
