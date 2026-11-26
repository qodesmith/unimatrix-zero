import {execFile, spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'

/**
 * Git reads this as an empty file on every platform, but not as a folder:
 * Windows reads `/dev/null/<hook>` as a real path on the drive.
 */
const NOTHING = '/dev/null'

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024

/** `core.hooksPath` names the program file, which holds no hooks (ADR 0014). */
function isolation(program: string) {
  return [
    '-c',
    `core.hooksPath=${program}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.excludesFile=${NOTHING}`,
    '-c',
    `core.attributesFile=${NOTHING}`,
  ]
}

export interface Checkout {
  folder: string
  index: string
}

interface GitTarget {
  store: string
  checkout?: Checkout
}

/** Variables alone name the store, so no `.git` lands in a Working copy. */
function isolated(
  env: NodeJS.ProcessEnv,
  program: string,
  {store, checkout}: GitTarget
): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith('GIT_'))
  )

  return {
    ...inherited,
    ...ownSubPrograms(program),
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

/**
 * The Mac and Linux builds look for their sub-programs in `/libexec/git-core`
 * unless told; Windows `git` finds its own (ADR 0024).
 */
function ownSubPrograms(program: string) {
  if (process.platform === 'win32') return {}

  return {
    GIT_EXEC_PATH: path.join(
      path.dirname(program),
      '..',
      'libexec',
      'git-core'
    ),
  }
}

export type Git = (
  target: GitTarget,
  args: string[],
  input?: string
) => Promise<string>

/** Runs the app's own `git`, never one on `PATH` (ADR 0024). */
export function createGit(program: string, env: NodeJS.ProcessEnv): Git {
  return async (target, args, input) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        program,
        [...isolation(program), ...args],
        {
          env: isolated(env, program, target),
          cwd: target.checkout?.folder,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(stdout)
        }
      )

      // Unhandled, the broken pipe from a git that exits before reading its
      // input would crash the app; the exit callback reports why.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    })
}

export interface GitBlobs {
  write: (store: string, blob: string, file: string) => Promise<void>
  /** Up to `bytes` from its start, read without the rest. */
  start: (store: string, blob: string, bytes: number) => Promise<Buffer>
}

function catBlob(
  program: string,
  env: NodeJS.ProcessEnv,
  store: string,
  blob: string
) {
  const child = spawn(
    program,
    [...isolation(program), 'cat-file', 'blob', blob],
    {
      env: isolated(env, program, {store}),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  )

  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve(code))
  })

  return {child, exited, stderr: () => Buffer.concat(stderr).toString('utf8')}
}

/** `createGit` reads output as text, which would garble a binary file. */
export function createGitBlobs(
  program: string,
  env: NodeJS.ProcessEnv
): GitBlobs {
  return {
    async write(store, blob, file) {
      const cat = catBlob(program, env, store, blob)
      await pipeline(cat.child.stdout, fs.createWriteStream(file))

      if ((await cat.exited) !== 0) throw new Error(cat.stderr())
    },

    async start(store, blob, bytes) {
      const cat = catBlob(program, env, store, blob)
      const chunks: Buffer[] = []
      let read = 0

      for await (const chunk of cat.child.stdout) {
        if (!Buffer.isBuffer(chunk)) continue

        chunks.push(chunk)
        read += chunk.byteLength

        if (read >= bytes) break
      }

      cat.child.kill()
      const code = await cat.exited

      if (read < bytes && code !== 0) throw new Error(cat.stderr())

      return Buffer.concat(chunks).subarray(0, bytes)
    },
  }
}
