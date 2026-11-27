/**
 * A recording is a real conversation a live test saved for the everyday tests
 * to replay. Its `start` line names the build that made it.
 */
import type {GitHubApi, Pins} from './vendor-pins.ts'

import path from 'node:path'
import {z} from 'zod'

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
    return `  ${file} was made by ${build}, a program with no pin.`
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

const PullFiles = z.array(z.looseObject({filename: z.string()}))

/** GitHub lists at most 3,000 of a PR's files, which is plenty here. */
export async function changedFilesOf(api: GitHubApi, repo: string, pr: number) {
  const files: string[] = []

  for (let page = 1; ; page++) {
    const batch = PullFiles.parse(
      JSON.parse(
        await api(`repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`)
      )
    )

    files.push(...batch.map(file => file.filename))

    if (batch.length < 100) return files
  }
}

/** The recordings last written before `since`, a run's start in ms. */
export function unrewritten(
  recordings: {file: string; modified: number}[],
  since: number
) {
  return recordings.flatMap(recording =>
    recording.modified < since ? [recording.file] : []
  )
}
