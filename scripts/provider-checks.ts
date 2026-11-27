/**
 * Run by hand by the maintainer: re-records the recordings, and posts results
 * on the PR CI's gate holds.
 */
import type {CheckStatus} from './provider-checks-result.ts'
import type {Entry} from './provider-dependencies.ts'
import type {Builds} from './provider-review.ts'
import type {Pins} from './vendor-pins.ts'

import {$} from 'bun'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {z} from 'zod'

import {devUserData} from './dev-data.ts'
import {mapLimited} from './map-limited.ts'
import {passed, renderResult} from './provider-checks-result.ts'
import {LIST, entriesOf, liveCheckOf, tagsIn} from './provider-dependencies.ts'
import {review} from './provider-review.ts'
import {
  filesIn,
  gatedChangesOf,
  isRecording,
  unrewritten,
} from './recordings.ts'
import {
  HOST_PACKAGE,
  INSTALLED_SDK,
  MANIFEST,
  SDK,
  pinsOf,
} from './vendor-pins.ts'

const root = path.resolve(import.meta.dirname, '..')
const GATE_JOB = 'Provider checks on a vendor bump or a live test change'
const REVIEWERS = 4

const PullPages = z.array(
  z.array(
    z.looseObject({
      number: z.number(),
      base: z.looseObject({sha: z.string()}),
      head: z.looseObject({sha: z.string(), ref: z.string()}),
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

const InstalledPackage = z.looseObject({version: z.string()})

const Jobs = z.looseObject({
  jobs: z.array(z.looseObject({id: z.number(), name: z.string()})),
})

interface Gated {
  number: number
  head: string
  branch: string
  pinChanges: string[]
  files: string[]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function api(call: string) {
  return $`gh api ${call}`.text()
}

function requirePinnedSdk(pins: Pins) {
  const installed = path.join(INSTALLED_SDK, 'package.json')

  const version = fs.existsSync(path.join(root, installed))
    ? InstalledPackage.parse(JSON.parse(readText(installed))).version
    : 'not installed'

  if (version !== pins.get(SDK)) {
    fail(
      `The Agent SDK in ${installed} is ${version}, not the pinned ${pins.get(SDK)}: run \`bun install\`, then run this again.`
    )
  }
}

function liveBuilds() {
  const pins = pinsOf(readText(MANIFEST), readText(HOST_PACKAGE))
  requirePinnedSdk(pins)
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

async function findGated(repo: string, wanted: number | null) {
  const call = `repos/${repo}/pulls?state=open&per_page=100`
  const pages = await $`gh api --paginate --slurp ${call}`.text()
  const open = PullPages.parse(JSON.parse(pages)).flat()

  const gated: Gated[] = []

  for (const pull of open) {
    if (wanted !== null && pull.number !== wanted) continue

    const {pinChanges, files} = await gatedChangesOf(api, repo, {
      number: pull.number,
      base: pull.base.sha,
      head: pull.head.sha,
    })

    if (pinChanges.length > 0 || files.length > 0) {
      gated.push({
        number: pull.number,
        head: pull.head.sha,
        branch: pull.head.ref,
        pinChanges,
        files,
      })
    }
  }

  if (wanted !== null && gated.length === 0) {
    fail(
      `#${wanted} isn't an open PR that moves a vendor pin or changes a live test, a recorder or a recording.`
    )
  }

  if (gated.length > 1) {
    fail(
      `${gated.length} open PRs need provider-checks (${gated.map(pull => `#${pull.number}`).join(', ')}): pick one with --pr <n>.`
    )
  }

  return gated[0] ?? null
}

async function isCleanAt(head: string) {
  const current = (await $`git rev-parse HEAD`.cwd(root).text()).trim()
  const dirty = (await $`git status --porcelain`.cwd(root).text()).trim()

  return current === head && !dirty
}

/** Each `[records]` test also rewrites its recordings. */
async function runLiveChecks(ids: string[], env: Record<string, string>) {
  const report = path.join(os.tmpdir(), `uz-provider-checks-${Date.now()}.json`)

  const exitCode = await Bun.spawn(
    [
      'bun',
      'run',
      'scripts/vitest.ts',
      'run',
      '.live.test.ts',
      '--project',
      'node',
      '-t',
      String.raw`\[dep:|\[records\]`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ],
    {
      cwd: root,
      env: {...process.env, ...env, UZ_RECORD: 'yes'},
      stdio: ['inherit', 'inherit', 'inherit'],
    }
  ).exited

  const outcomes = new Map<string, string[]>()

  const ran = await Bun.file(report)
    .json()
    .catch(() => ({testResults: []}))

  const tests = VitestReport.parse(ran).testResults.flatMap(
    file => file.assertionResults
  )

  for (const test of tests) {
    for (const id of tagsIn(test.title)) {
      outcomes.set(id, [...(outcomes.get(id) ?? []), test.status])
    }
  }

  return {
    checks: ids.map(id => ({id, status: statusOf(outcomes.get(id) ?? [])})),
    failed: exitCode !== 0 || tests.some(test => test.status === 'failed'),
  }
}

async function recordings() {
  return (await filesIn(root)).filter(isRecording)
}

/** Why the run must keep the old recordings, or null when it can commit. */
async function whyKept(since: number, failed: boolean) {
  if (failed) return 'a live test failed'

  const missed = unrewritten(
    (await recordings()).map(file => ({
      file,
      modified: fs.statSync(path.join(root, file)).mtimeMs,
    })),
    since
  )

  return missed.length > 0
    ? `no live test rewrote ${missed.map(file => `\`${file}\``).join(', ')}`
    : null
}

async function commitRecordings() {
  await $`git add -- ${await recordings()}`.cwd(root)
  await $`git commit --quiet -m ${'Re-record the recordings for provider-checks'}`.cwd(
    root
  )

  return (await $`git rev-parse HEAD`.cwd(root).text()).trim()
}

async function runEverydayTests(): Promise<CheckStatus> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('UZ_LIVE_') && name !== 'UZ_RECORD'
    )
  )

  const exitCode = await Bun.spawn(['bun', 'run', 'test'], {
    cwd: root,
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
  }).exited

  return exitCode === 0 ? 'passed' : 'failed'
}

function statusOf(outcomes: string[]): CheckStatus {
  if (outcomes.includes('failed')) return 'failed'

  return outcomes.length > 0 && outcomes.every(outcome => outcome === 'passed')
    ? 'passed'
    : 'not run'
}

async function reviewAll(entries: Entry[], builds: Builds) {
  return mapLimited(entries, REVIEWERS, async entry => {
    console.log(`Reviewing ${entry.id}…`)

    return review(entry, builds, root)
  })
}

async function rerunGate(repo: string, pull: Gated) {
  const {
    workflow_runs: [run],
  } = Runs.parse(
    JSON.parse(
      await api(
        `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${pull.head}&event=pull_request`
      )
    )
  )

  if (run?.status !== 'completed') {
    console.warn(
      `CI on ${pull.head} hasn't finished: once it has, re-run its "${GATE_JOB}" job.`
    )

    return
  }

  const {jobs} = Jobs.parse(
    JSON.parse(await api(`repos/${repo}/actions/runs/${run.id}/jobs`))
  )

  const gate = jobs.find(job => job.name === GATE_JOB)

  if (!gate) fail(`CI run ${run.id} has no "${GATE_JOB}" job.`)

  await $`gh api -X POST repos/${repo}/actions/jobs/${gate.id}/rerun`.quiet()
  console.log(`Re-running "${GATE_JOB}" on #${pull.number}.`)
}

const {values} = parseArgs({options: {pr: {type: 'string'}}})
const {builds, env} = liveBuilds()

const repo = (
  await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()
).trim()

const pull = await findGated(repo, values.pr ? Number(values.pr) : null)
const postTo = pull && (await isCleanAt(pull.head)) ? pull : null

const entries = entriesOf(readText(LIST))

const live = entries.flatMap(entry =>
  liveCheckOf(entry) === entry.id ? [entry.id] : []
)

const since = Date.now()
const {checks, failed} = await runLiveChecks(live, env)
const kept = await whyKept(since, failed)
const committed = postTo && kept === null ? await commitRecordings() : null

const result = {
  head: committed ?? postTo?.head ?? null,
  pinChanges: postTo?.pinChanges ?? [],
  gatedFiles: postTo?.files ?? [],
  checks,
  reviews: await reviewAll(entries, builds),
  whyKept: kept,
  everydayTests: await runEverydayTests(),
}

const body = renderResult(result)

console.log(`\n${body}`)

if (postTo) {
  await $`gh pr comment ${postTo.number} --body-file - < ${new Response(body)}`.cwd(
    root
  )

  // Pushed after the comment, so CI's gate on the new commit finds its result.
  await (committed
    ? $`git push origin ${`HEAD:refs/heads/${postTo.branch}`}`.cwd(root)
    : rerunGate(repo, postTo))
} else if (pull) {
  console.warn(
    `Nothing was posted or committed: a result for #${pull.number} must come from a clean checkout of its head ${pull.head} (gh pr checkout ${pull.number}).`
  )
} else {
  console.warn(
    'No open PR needs provider-checks: nothing was posted, and the new recordings are left uncommitted.'
  )
}

process.exit(passed(result) ? 0 : 1)
