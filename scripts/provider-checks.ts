/**
 * `bun run provider-checks [--pr <n>]`, by hand on the maintainer's machine:
 * runs every `[dep:<id>]` live check, has an agent review each entry of the
 * list, and posts both on the open bump PR for CI's gate.
 */
import type {CheckStatus, Review} from './provider-checks-result.ts'
import type {Entry} from './provider-dependencies.ts'
import type {Builds} from './provider-review.ts'

import {$} from 'bun'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {z} from 'zod'

import {devUserData} from './dev-data.ts'
import {passed, renderResult} from './provider-checks-result.ts'
import {LIST, entriesOf, liveCheckOf, tagsIn} from './provider-dependencies.ts'
import {review} from './provider-review.ts'
import {HOST_PACKAGE, MANIFEST, bumpOf, pinsOf} from './vendor-pins.ts'

const root = path.resolve(import.meta.dirname, '..')
const GATE_JOB = 'Provider checks on a vendor bump'
const REVIEWERS = 4

const PullPages = z.array(
  z.array(
    z.looseObject({
      number: z.number(),
      base: z.looseObject({sha: z.string()}),
      head: z.looseObject({sha: z.string()}),
    })
  )
)

const VitestReport = z.looseObject({
  testResults: z.array(
    z.looseObject({
      assertionResults: z.array(
        z.looseObject({title: z.string(), status: z.string()})
      ),
    })
  ),
})

const Runs = z.looseObject({
  workflow_runs: z.array(
    z.looseObject({id: z.number(), status: z.string().nullable()})
  ),
})

const Jobs = z.looseObject({
  jobs: z.array(z.looseObject({id: z.number(), name: z.string()})),
})

interface Bump {
  number: number
  head: string
  changes: string[]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function api(call: string) {
  return $`gh api ${call}`.text()
}

/**
 * The pinned builds and sign-ins in this checkout's own dev data, which
 * `bun run dev` downloads and the app's connect flow fills.
 */
function liveBuilds() {
  const pins = pinsOf(readText(MANIFEST), readText(HOST_PACKAGE))
  const userData = devUserData(root)

  const env = {
    UZ_LIVE_CLAUDE_PROGRAM: path.join(
      userData,
      'vendor',
      'claude',
      pins.get('claude') ?? '',
      'claude'
    ),
    UZ_LIVE_CLAUDE_CONFIG: path.join(userData, 'providers', 'claude'),
    UZ_LIVE_CODEX_PROGRAM: path.join(
      userData,
      'vendor',
      'chatgpt',
      pins.get('codex') ?? ''
    ),
    UZ_LIVE_CODEX_HOME: path.join(userData, 'providers', 'chatgpt'),
  }

  const needed = [
    ...Object.values(env),
    path.join(env.UZ_LIVE_CODEX_HOME, 'auth.json'),
  ]

  const missing = needed.filter(file => !fs.existsSync(file))

  if (missing.length > 0) {
    fail(
      [
        "This checkout's dev data lacks the pinned builds or a sign-in:",
        ...missing.map(file => `  ${file}`),
        'Run `bun run dev` here, connect Claude and ChatGPT, then run this again.',
      ].join('\n')
    )
  }

  const builds: Builds = {
    pins,
    claudeProgram: env.UZ_LIVE_CLAUDE_PROGRAM,
    codexFolder: env.UZ_LIVE_CODEX_PROGRAM,
  }

  return {builds, env}
}

function readText(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

async function findBump(repo: string, wanted: number | null) {
  const call = `repos/${repo}/pulls?state=open&per_page=100`
  const pages = await $`gh api --paginate --slurp ${call}`.text()
  const open = PullPages.parse(JSON.parse(pages)).flat()

  const bumps: Bump[] = []

  for (const pull of open) {
    if (wanted !== null && pull.number !== wanted) continue

    const changes = await bumpOf(api, repo, {
      base: pull.base.sha,
      head: pull.head.sha,
    })

    if (changes.length > 0) {
      bumps.push({number: pull.number, head: pull.head.sha, changes})
    }
  }

  if (wanted !== null && bumps.length === 0) {
    fail(`#${wanted} isn't an open PR that moves a vendor pin.`)
  }

  if (bumps.length > 1) {
    fail(
      `${bumps.length} bump PRs are open (${bumps.map(bump => `#${bump.number}`).join(', ')}): pick one with --pr <n>.`
    )
  }

  return bumps[0] ?? null
}

async function checkedOut(bump: Bump) {
  const head = (await $`git rev-parse HEAD`.cwd(root).text()).trim()
  const dirty = (await $`git status --porcelain`.cwd(root).text()).trim()

  if (head !== bump.head || dirty) {
    fail(
      `The result is tied to #${bump.number}'s head ${bump.head}: run on a clean checkout of it (gh pr checkout ${bump.number}).`
    )
  }
}

async function runLiveChecks(ids: string[], env: Record<string, string>) {
  const report = path.join(os.tmpdir(), `uz-provider-checks-${Date.now()}.json`)

  await Bun.spawn(
    [
      'bun',
      'run',
      'scripts/vitest.ts',
      'run',
      '.live.test.ts',
      '--project',
      'node',
      '-t',
      String.raw`\[dep:`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ],
    {
      cwd: root,
      env: {...process.env, ...env},
      stdio: ['inherit', 'inherit', 'inherit'],
    }
  ).exited

  const outcomes = new Map<string, string[]>()

  const ran = await Bun.file(report)
    .json()
    .catch(() => ({testResults: []}))

  for (const file of VitestReport.parse(ran).testResults) {
    for (const test of file.assertionResults) {
      for (const id of tagsIn(test.title)) {
        outcomes.set(id, [...(outcomes.get(id) ?? []), test.status])
      }
    }
  }

  return ids.map(id => ({id, status: statusOf(outcomes.get(id) ?? [])}))
}

function statusOf(outcomes: string[]): CheckStatus {
  if (outcomes.includes('failed')) return 'failed'

  return outcomes.length > 0 && outcomes.every(outcome => outcome === 'passed')
    ? 'passed'
    : 'not run'
}

async function reviewAll(entries: Entry[], builds: Builds) {
  const reviews: Review[] = []
  let next = 0

  async function reviewer() {
    for (let entry = entries[next++]; entry; entry = entries[next++]) {
      console.log(`Reviewing ${entry.id}…`)
      reviews.push(await review(entry, builds, root))
    }
  }

  await Promise.all(Array.from({length: REVIEWERS}, reviewer))

  return entries.flatMap(entry =>
    reviews.filter(reviewed => reviewed.id === entry.id)
  )
}

/** CI read the comments before this run posted; its gate job reads them again. */
async function rerunGate(repo: string, bump: Bump) {
  const {
    workflow_runs: [run],
  } = Runs.parse(
    JSON.parse(
      await api(
        `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${bump.head}&event=pull_request`
      )
    )
  )

  if (run?.status !== 'completed') {
    console.warn(
      `CI on ${bump.head} hasn't finished: once it has, re-run its "${GATE_JOB}" job.`
    )

    return
  }

  const {jobs} = Jobs.parse(
    JSON.parse(await api(`repos/${repo}/actions/runs/${run.id}/jobs`))
  )

  const gate = jobs.find(job => job.name === GATE_JOB)

  if (!gate) fail(`CI run ${run.id} has no "${GATE_JOB}" job.`)

  await $`gh api -X POST repos/${repo}/actions/jobs/${gate.id}/rerun`.quiet()
  console.log(`Re-running "${GATE_JOB}" on #${bump.number}.`)
}

const {values} = parseArgs({options: {pr: {type: 'string'}}})
const {builds, env} = liveBuilds()

const repo = (
  await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()
).trim()

const bump = await findBump(repo, values.pr ? Number(values.pr) : null)

if (bump) await checkedOut(bump)

const entries = entriesOf(readText(LIST))

const live = entries.flatMap(entry =>
  liveCheckOf(entry) === entry.id ? [entry.id] : []
)

const result = {
  head: bump?.head ?? null,
  pinChanges: bump?.changes ?? [],
  checks: await runLiveChecks(live, env),
  reviews: await reviewAll(entries, builds),
}

const body = renderResult(result)

console.log(`\n${body}`)

if (bump) {
  await $`gh pr comment ${bump.number} --body-file - < ${new Response(body)}`.cwd(
    root
  )
  await rerunGate(repo, bump)
} else {
  console.warn('No bump PR is open: there was nothing to comment on.')
}

process.exit(passed(result) ? 0 : 1)
