import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {z} from 'zod'

const repo = path.resolve(import.meta.dirname, '../..')
const oxlint = path.join(repo, 'node_modules/oxlint/bin/oxlint')

const Report = z.looseObject({
  diagnostics: z.array(
    z.looseObject({code: z.string(), message: z.string(), filename: z.string()})
  ),
})

type Diagnostic = z.output<typeof Report>['diagnostics'][number]

/**
 * The real oxlint over fixture files in a fresh folder, with this repo's JS
 * plugins loaded and only `rules` turned on.
 */
export function lintFixture(
  rules: readonly string[],
  files: Readonly<Record<string, string>>
): Diagnostic[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'uz-lint-'))

  const config = {
    plugins: [],
    categories: {correctness: 'off'},
    jsPlugins: [
      path.join(import.meta.dirname, 'uz/index.ts'),
      path.join(import.meta.dirname, 'anti-slop/index.ts'),
    ],
    rules: Object.fromEntries(rules.map(rule => [rule, 'error'])),
  }

  writeFileSync(path.join(dir, '.oxlintrc.json'), JSON.stringify(config))

  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), {recursive: true})
    writeFileSync(path.join(dir, file), text)
  }

  // Plain Node, not `process.execPath`: the tests run under Electron's Node,
  // where oxlint crashes with SIGTRAP once it loads a JS plugin.
  const result = spawnSync(
    'node',
    [oxlint, '-f', 'json', ...Object.keys(files)],
    {cwd: dir, encoding: 'utf8'}
  )

  rmSync(dir, {recursive: true, force: true})

  try {
    return Report.parse(JSON.parse(result.stdout)).diagnostics
  } catch {
    throw new Error(`oxlint gave no report:\n${result.stdout}${result.stderr}`)
  }
}

/** The rule codes reported for one file, in the order oxlint gave them. */
export function codesFor(diagnostics: Diagnostic[], filename: string) {
  return diagnostics
    .values()
    .filter(diagnostic => diagnostic.filename === filename)
    .map(diagnostic => diagnostic.code)
    .toArray()
}
