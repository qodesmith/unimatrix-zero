import {$} from 'bun'
import path from 'node:path'

import {finishCheck} from './finish-check.ts'
import {LIST, entriesOf, problemsOf} from './provider-dependencies.ts'

const root = path.resolve(import.meta.dirname, '..')

const listed =
  await $`git ls-files --cached --others --exclude-standard -- '*.live.test.ts'`
    .cwd(root)
    .text()

const tests = await Promise.all(
  listed
    .split('\n')
    .filter(Boolean)
    .map(async file => ({
      file,
      source: await Bun.file(path.join(root, file)).text(),
    }))
)

const list = await Bun.file(path.join(root, LIST)).text()

finishCheck(
  problemsOf(list, tests),
  `${LIST} and the [dep:<id>] tests don't match:`,
  `All ${entriesOf(list).length} Provider dependencies have a live check or a reason.`
)
