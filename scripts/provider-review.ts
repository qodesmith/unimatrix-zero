/**
 * The review half of `bun run provider-checks`: an agent on the maintainer's
 * own `claude` login reads one entry against the code and the pinned builds.
 */
import type {Review} from './provider-checks-result.ts'
import type {Entry} from './provider-dependencies.ts'
import type {Pins} from './vendor-pins.ts'

import path from 'node:path'
import {z} from 'zod'

import {LIST} from './provider-dependencies.ts'
import {INSTALLED_SDK} from './vendor-pins.ts'

export interface Builds {
  pins: Pins
  claudeProgram: string
  codexFolder: string
}

const VERDICTS = [
  'holds',
  'stale on the Provider side',
  'stale on the app side',
  'stale on both sides',
] as const

const Answer = z.object({verdict: z.enum(VERDICTS), evidence: z.string()})

const Output = z.looseObject({
  subtype: z.string(),
  structured_output: Answer.optional(),
})

const TOOLS = ['Read', 'Grep', 'Glob', 'Bash(strings:*)', 'Bash(grep:*)']

const TIME_LIMIT_MS = 10 * 60 * 1000

function promptFor(entry: Entry, builds: Builds) {
  const fields = Object.entries(entry.fields).map(
    ([name, value]) => `- **${name}:** ${value}`
  )

  return `You are checking one entry of ${LIST}, the list of places where this app relies on what a vendor program (\`claude\`, Codex's app-server), the Agent SDK or a Model happens to do. Read the top of that file for what each field means.

The entry:

### ${entry.title}
${fields.join('\n')}

Decide whether it still holds, on both sides:

- Provider side: the pinned builds still behave as "Relies on" says. The pins: ${[
    ...builds.pins,
  ]
    .map(([name, version]) => `${name} ${version}`)
    .join(', ')}. The builds:
  - claude: the binary ${builds.claudeProgram} (search it with \`strings <binary> | grep -F <text>\`; a regex over the binary itself runs for hours)
  - the Agent SDK: ${INSTALLED_SDK}
  - the Codex app-server: the folder ${builds.codexFolder}, with the types generated from it in app/provider-host/src/modules/codex-driver/protocol/
- App side: the code in this repo still does what "App side" says, so the entry still describes something.

A live check covers what only running the program can show; you settle what reading can. Call the entry stale only on evidence you found: name the file and what it says. When reading can't settle it, it holds. Give the evidence in a few sentences.`
}

/** The environment for the reviewer: the maintainer's login, never an API key. */
function reviewerEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('ANTHROPIC_') && name !== 'CLAUDECODE'
    )
  )
}

function outputOf(stdout: string) {
  try {
    return Output.parse(JSON.parse(stdout))
  } catch {
    return null
  }
}

export async function review(
  entry: Entry,
  builds: Builds,
  root: string
): Promise<Review> {
  const child = Bun.spawn(
    [
      'claude',
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      // claude rejects Zod's default $schema, draft 2020-12.
      JSON.stringify(z.toJSONSchema(Answer, {target: 'draft-07'})),
      '--tools',
      'Read,Grep,Glob,Bash',
      '--allowedTools',
      ...TOOLS,
      '--permission-mode',
      'dontAsk',
      '--no-session-persistence',
      '--add-dir',
      path.dirname(builds.claudeProgram),
      builds.codexFolder,
    ],
    {
      cwd: root,
      env: reviewerEnvironment(),
      stdin: new Blob([promptFor(entry, builds)]),
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    }
  )

  // The whole group, so a search the reviewer started dies with it.
  const limit = setTimeout(() => {
    process.kill(-child.pid, 'SIGKILL')
  }, TIME_LIMIT_MS)

  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  clearTimeout(limit)

  if (child.signalCode === 'SIGKILL') {
    return {
      id: entry.id,
      verdict: 'not reviewed',
      reason: `ran past ${TIME_LIMIT_MS / 60_000} minutes`,
    }
  }

  const output = outputOf(stdout)
  const answer = output?.structured_output

  if (!answer) {
    const why = output?.subtype ?? stderr.trim()

    return {id: entry.id, verdict: 'not reviewed', reason: why || 'no answer'}
  }

  return answer.verdict === 'holds'
    ? {id: entry.id, verdict: 'holds', reason: answer.evidence}
    : {
        id: entry.id,
        verdict: 'stale',
        reason: `${answer.verdict}: ${answer.evidence}`,
      }
}
