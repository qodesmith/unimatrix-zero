import type {Checkout, FileState, SavedRun} from './provider-checks-resume.ts'

import {$} from 'bun'
import fs from 'node:fs'
import path from 'node:path'

import {savedRunOf, whyNotResumable} from './provider-checks-resume.ts'

function namesIn(output: string) {
  return output.split('\0').filter(Boolean)
}

/** Per worktree, and inside `.git`, so no commit or `git status` ever sees it. */
export async function savedRunFile(root: string) {
  const file = await $`git rev-parse --git-path provider-checks/saved-run.json`
    .cwd(root)
    .text()

  return path.resolve(root, file.trim())
}

export function saveRun(file: string, run: SavedRun) {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`)
}

export async function headOf(root: string) {
  return (await $`git rev-parse HEAD`.cwd(root).text()).trim()
}

export async function dirtyIn(root: string): Promise<FileState[]> {
  const [tracked, untracked] = await Promise.all([
    $`git diff --name-only --no-renames -z HEAD`.cwd(root).text(),
    $`git ls-files --others --exclude-standard -z`.cwd(root).text(),
  ])

  const files = [...new Set([...namesIn(tracked), ...namesIn(untracked)])]

  return Promise.all(
    files.map(async file => ({
      file,
      hash: fs.existsSync(path.join(root, file))
        ? (await $`git hash-object -- ${file}`.cwd(root).text()).trim()
        : null,
    }))
  )
}

async function changedSince(root: string, commit: string | null) {
  if (commit === null) return null

  const diff = await $`git diff --name-only --no-renames -z ${commit} HEAD`
    .cwd(root)
    .nothrow()
    .quiet()

  return diff.exitCode === 0 ? namesIn(diff.text()) : null
}

async function reaches(root: string, commit: string) {
  const found = await $`git merge-base --is-ancestor ${commit} HEAD`
    .cwd(root)
    .nothrow()
    .quiet()

  return found.exitCode === 0
}

/** The run saved in the checkout at `root`, and why it can't be resumed. */
export async function resumeFrom(
  root: string,
  current: Pick<Checkout, 'pins' | 'builds'> & {
    pull: {number: number; head: string} | null
  }
) {
  const file = await savedRunFile(root)

  const saved = fs.existsSync(file)
    ? savedRunOf(fs.readFileSync(file, 'utf8'))
    : null

  if (fs.existsSync(file) && !saved) {
    return {saved, why: `The saved run in ${file} can't be read.`}
  }

  const {pull, pins, builds} = current

  const checkout: Checkout = {
    pr: pull?.number ?? null,
    prHeadReached: pull ? await reaches(root, pull.head) : false,
    pins,
    builds,
    changedSince: await changedSince(root, saved?.head ?? null),
    dirty: await dirtyIn(root),
  }

  return {saved, why: whyNotResumable(saved, checkout)}
}
