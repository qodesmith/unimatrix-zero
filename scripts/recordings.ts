import type {GitHubApi, Pins} from './vendor-pins.ts'

import {execFile} from 'node:child_process'
import path from 'node:path'
import {promisify} from 'node:util'
import {z} from 'zod'

import {bumpOf} from './vendor-pins.ts'

const RECORDING = /(?:^|\/)recordings\//
const LIVE_TEST = /\.live\.test\.ts$/
const RECORDER = /(?:^|\/)recording\.ts$/

const RE_RECORD = 'run `bun run provider-checks` to re-record it.'

const StartLine = z.looseObject({kind: z.literal('start')})

const Stamp = z.looseObject({build: z.string()})

export function isRecording(file: string) {
  return RECORDING.test(file)
}

export function isLiveTest(file: string) {
  return LIVE_TEST.test(file)
}

/** A PR that changes one of these needs a re-record, as a bump PR does. */
export function gatedFiles(files: string[]) {
  return files.filter(
    file => isRecording(file) || isLiveTest(file) || RECORDER.test(file)
  )
}

function buildOf(text: string) {
  const [first = ''] = text.split('\n')

  try {
    const start = StartLine.parse(JSON.parse(first))

    return Stamp.safeParse(start).data?.build ?? null
  } catch {
    return null
  }
}

function moduleOf(recording: string) {
  return path.posix.dirname(path.posix.dirname(recording))
}

function stampProblem(file: string, build: string | null, pins: Pins) {
  if (build === null) return `  ${file} names no build: ${RE_RECORD}`

  const [program = '', version] = build.split(' ')
  const pinned = pins.get(program)

  if (pinned === undefined) {
    return `  ${file} was made by ${build}, a program with no pin: ${RE_RECORD}`
  }

  return version === pinned
    ? null
    : `  ${file} was made by ${build}, not the pinned ${program} ${pinned}: ${RE_RECORD}`
}

/** A live test writes a recording when it names its file, in its own module. */
export function problemsOf(
  recordings: {file: string; text: string}[],
  liveTests: {file: string; source: string}[],
  pins: Pins
) {
  return recordings.flatMap(({file, text}) => {
    const stamp = stampProblem(file, buildOf(text), pins)
    const module = moduleOf(file)
    const name = path.posix.basename(file)

    const written = liveTests.some(
      test =>
        path.posix.dirname(test.file) === module &&
        ['"', "'", '`'].some(quote =>
          test.source.includes(`${quote}${name}${quote}`)
        )
    )

    return [
      ...(stamp ? [stamp] : []),
      ...(written
        ? []
        : [
            `  ${file} is written by no live test in ${module}: delete it, or record it from one.`,
          ]),
    ]
  })
}

const PullFiles = z.array(
  z.looseObject({
    filename: z.string(),
    previous_filename: z.string().optional(),
  })
)

export async function changedFilesOf(api: GitHubApi, repo: string, pr: number) {
  const files: string[] = []

  for (let page = 1; ; page++) {
    const batch = PullFiles.parse(
      JSON.parse(
        await api(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`)
      )
    )

    files.push(
      ...batch.flatMap(file => [
        file.filename,
        ...(file.previous_filename ? [file.previous_filename] : []),
      ])
    )

    if (batch.length < 100) return files
  }
}

/** Why CI's gate holds a PR, which is when either list has something. */
export async function gatedChangesOf(
  api: GitHubApi,
  repo: string,
  pr: {number: number; base: string; head: string}
) {
  const [pinChanges, changed] = await Promise.all([
    bumpOf(api, repo, {base: pr.base, head: pr.head}),
    changedFilesOf(api, repo, pr.number),
  ])

  return {pinChanges, files: gatedFiles(changed)}
}

export async function filesIn(root: string) {
  const {stdout} = await promisify(execFile)(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    {cwd: root, maxBuffer: 64 * 1024 * 1024}
  )

  return stdout.split('\n').filter(Boolean)
}

export function unrewritten(
  recordings: {file: string; modified: number}[],
  since: number
) {
  return recordings.flatMap(recording =>
    recording.modified < since ? [recording.file] : []
  )
}
