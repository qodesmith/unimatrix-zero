/**
 * Shows how each shadcn file we own differs from what `shadcn add` writes
 * today, so an upstream change can be picked in by hand. It generates in a
 * throwaway worktree and never writes to this one. `bun run shadcn:updates`
 * checks every component in app/renderer/src/shadcn; `bun run shadcn:updates
 * slider sheet` checks only the ones named.
 */
import {$, Glob} from 'bun'
import {existsSync} from 'node:fs'
import {mkdtemp} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const shadcnDir = 'app/renderer/src/shadcn'
const color = process.stdout.isTTY ? 'always' : 'never'

async function filesUnder(dir: string) {
  const files: string[] = []

  if (!existsSync(dir)) return files

  for await (const file of new Glob('**/*.{ts,tsx}').scan(dir)) {
    files.push(file)
  }

  return files
}

function componentName(file: string) {
  return path.basename(file).replace(/\.tsx?$/, '')
}

// Uncommitted changes to the CSS, the config or the packages change what
// `shadcn add` and the formatter write, so the worktree gets them too.
async function copyUncommitted(tree: string) {
  const patch = await $`git diff HEAD --binary`.cwd(root).quiet()

  if (patch.stdout.length > 0)
    await $`git apply --index --whitespace=nowarn < ${patch.stdout}`
      .cwd(tree)
      .quiet()
}

async function generate(tree: string, names: string[]) {
  const failed: string[] = []

  await copyUncommitted(tree)
  await $`bun install --frozen-lockfile`.cwd(tree).quiet()
  await $`rm -rf ${shadcnDir}`.cwd(tree)

  for (const name of names) {
    const result = await $`bun x shadcn add ${name} --overwrite --yes`
      .cwd(path.join(tree, 'app/renderer'))
      .quiet()
      .nothrow()

    if (result.exitCode !== 0) failed.push(name)
  }

  await $`bun x oxfmt ${shadcnDir}`.cwd(tree).quiet().nothrow()

  return failed
}

async function diff(ours: string, upstream: string, tree: string) {
  const result =
    await $`git diff --no-index --color=${color} -- ${ours} ${upstream}`
      .quiet()
      .nothrow()

  return result.stdout
    .toString()
    .replaceAll(`${tree}/`, 'upstream/')
    .replaceAll(`${root}/`, 'ours/')
}

async function report(tree: string, checked: string[]) {
  const generated = await filesUnder(path.join(tree, shadcnDir))
  const same: string[] = []
  const differ: string[] = []

  for (const file of checked.filter(name => generated.includes(name))) {
    const output = await diff(
      path.join(root, shadcnDir, file),
      path.join(tree, shadcnDir, file),
      tree
    )

    if (output === '') same.push(file)
    else {
      differ.push(file)
      process.stdout.write(output)
    }
  }

  const packages =
    await $`git diff --color=${color} -- app/renderer/package.json`
      .cwd(tree)
      .quiet()
      .nothrow()

  process.stdout.write(packages.stdout.toString())

  return {
    same,
    differ,
    extra: generated.filter(name => !owned.includes(name)),
  }
}

function list(label: string, items: string[]) {
  if (items.length > 0)
    console.log(`${label} (${items.length}): ${items.join(', ')}`)
}

const owned = (await filesUnder(path.join(root, shadcnDir))).toSorted()
const requested = process.argv.slice(2)
const names = requested.length > 0 ? requested : owned.map(componentName)
const tree = await mkdtemp(path.join(os.tmpdir(), 'uz-shadcn-updates-'))

await $`git worktree add --quiet --detach ${tree} HEAD`.cwd(root)

try {
  const failed = await generate(tree, names)
  const checked = owned.filter(file => names.includes(componentName(file)))
  const {same, differ, extra} = await report(tree, checked)

  console.log('')
  list('Same as upstream', same)
  list('Differ from upstream (diff above: - ours, + upstream)', differ)
  list('Upstream also writes, and we do not own', extra)
  list('shadcn add failed for', failed)
} finally {
  await $`git worktree remove --force ${tree}`.cwd(root).quiet().nothrow()
}
