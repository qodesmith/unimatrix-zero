import {execFile} from 'node:child_process'

/** Git reads this path as an empty file on every platform, Windows included. */
const NOTHING = '/dev/null'

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024

/**
 * On every call: no hook runs, no fsmonitor is asked, and the user's own
 * ignore and attributes files stay out (ADR 0014).
 */
const ISOLATION = [
  '-c',
  `core.hooksPath=${NOTHING}`,
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.excludesFile=${NOTHING}`,
  '-c',
  `core.attributesFile=${NOTHING}`,
]

export interface Checkout {
  folder: string
  /** The folder's own index, kept in the store between Snapshots. */
  index: string
}

/**
 * The hidden store, alone or with one folder checked out of it and that
 * folder's index.
 */
interface GitTarget {
  store: string
  checkout?: Checkout
}

/**
 * The store is named by variables alone, so no `.git` is ever written into a
 * Working copy, and system and global config are never read.
 */
function isolated(
  env: NodeJS.ProcessEnv,
  {store, checkout}: GitTarget
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith('GIT_'))
  )

  return {
    ...inherited,
    GIT_DIR: store,
    ...(checkout && {
      GIT_WORK_TREE: checkout.folder,
      GIT_INDEX_FILE: checkout.index,
    }),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: NOTHING,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Unimatrix Zero',
    GIT_AUTHOR_EMAIL: 'snapshots@unimatrix-zero.invalid',
    GIT_COMMITTER_NAME: 'Unimatrix Zero',
    GIT_COMMITTER_EMAIL: 'snapshots@unimatrix-zero.invalid',
  }
}

export type Git = (
  target: GitTarget,
  args: string[],
  input?: string
) => Promise<string>

/** Every `git` call the app makes goes through the function this returns. */
export function createGit(env: NodeJS.ProcessEnv): Git {
  return async (target, args, input) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        [...ISOLATION, ...args],
        {
          env: isolated(env, target),
          cwd: target.checkout?.folder,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(stdout)
        }
      )

      // A git that ends before it reads its input breaks the pipe. Its exit,
      // above, says why; unheard, the pipe's error would take the app down.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    })
}
