/**
 * Bun reads neither `.bun-version` nor `devEngines`, but CI installs
 * `.bun-version`, so a local pass on another Bun says nothing about CI.
 */
import path from 'node:path'

import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')

const pinned = (await Bun.file(path.join(root, '.bun-version')).text()).trim()

const problems: string[] = []

if (Bun.version !== pinned) {
  problems.push(
    `Bun is ${Bun.version}, but .bun-version is ${pinned}.`,
    `Install Bun ${pinned} (or, to move the repo, set .bun-version and @types/bun to the new version and run bun install).`
  )
}

finishCheck(
  problems,
  'Bun is not the pinned version:',
  `Bun ${pinned} is the pinned version.`
)
