import {describe, expect, it} from 'vitest'

import {
  changedFilesOf,
  gatedFiles,
  problemsOf,
  unrewritten,
} from './recordings.ts'

const PINS = new Map([
  ['claude', '2.1.307'],
  ['codex', '0.163.0'],
])

const MODULE = 'app/provider-host/src/modules/codex-driver'

function recording(name: string, start: {kind: 'start'; build?: string}) {
  return {
    file: `${MODULE}/recordings/${name}`,
    text: `${JSON.stringify(start)}\n{"kind":"end"}\n`,
  }
}

const liveTest = {
  file: `${MODULE}/streaming.live.test.ts`,
  source: `createRecorder([path.join(RECORDINGS, 'started.ndjson')])`,
}

describe('the recordings lint', () => {
  it('passes a recording stamped with the pinned build, which a live test in its module writes', () => {
    expect(
      problemsOf(
        [recording('started.ndjson', {kind: 'start', build: 'codex 0.163.0'})],
        [liveTest],
        PINS
      )
    ).toEqual([])
  })

  it('fails a recording with no stamp, and says to re-record', () => {
    expect(
      problemsOf(
        [recording('started.ndjson', {kind: 'start'})],
        [liveTest],
        PINS
      )
    ).toEqual([
      `  ${MODULE}/recordings/started.ndjson names no build: run \`bun run provider-checks\` to re-record it.`,
    ])
  })

  it('fails a recording made by a build other than the pin, or by a program with no pin', () => {
    expect(
      problemsOf(
        [
          recording('started.ndjson', {kind: 'start', build: 'codex 0.162.0'}),
          recording('resumed.ndjson', {kind: 'start', build: 'gemini 1.0.0'}),
        ],
        [{...liveTest, source: `['started.ndjson', 'resumed.ndjson']`}],
        PINS
      )
    ).toEqual([
      `  ${MODULE}/recordings/started.ndjson was made by codex 0.162.0, not the pinned codex 0.163.0: run \`bun run provider-checks\` to re-record it.`,
      `  ${MODULE}/recordings/resumed.ndjson was made by gemini 1.0.0, a program with no pin.`,
    ])
  })

  it('fails a recording that no live test in its module writes', () => {
    const elsewhere = {
      file: 'app/provider-host/src/modules/claude-driver/streaming.live.test.ts',
      source: `liveDriver(['stale.ndjson'])`,
    }

    expect(
      problemsOf(
        [recording('stale.ndjson', {kind: 'start', build: 'codex 0.163.0'})],
        [liveTest, elsewhere],
        PINS
      )
    ).toEqual([
      `  ${MODULE}/recordings/stale.ndjson is written by no live test in ${MODULE}: delete it, or record it from one.`,
    ])
  })
})

describe('a PR the Provider checks gate holds', () => {
  it('changes a live test, a recorder or a recording, and nothing else counts', () => {
    expect(
      gatedFiles([
        `${MODULE}/streaming.live.test.ts`,
        `${MODULE}/recording.ts`,
        `${MODULE}/recordings/started.ndjson`,
        `${MODULE}/streaming.test.ts`,
        `${MODULE}/recording.test.ts`,
        `${MODULE}/replay.ts`,
        'docs/recordings.md',
      ])
    ).toEqual([
      `${MODULE}/streaming.live.test.ts`,
      `${MODULE}/recording.ts`,
      `${MODULE}/recordings/started.ndjson`,
    ])
  })

  it('is read from every page of its changed files', async () => {
    const pages = [
      Array.from({length: 100}, (_, at) => `a/${at}.ts`),
      [`${MODULE}/recordings/started.ndjson`],
    ]

    async function api(call: string) {
      const [, page] =
        /^repos\/o\/r\/pulls\/7\/files\?per_page=100&page=(\d+)$/.exec(call) ??
        []

      const files = pages[Number(page) - 1]

      if (!files) throw new Error(`Unexpected call: ${call}`)

      return JSON.stringify(files.map(filename => ({filename})))
    }

    const files = await changedFilesOf(api, 'o/r', 7)

    expect(files).toHaveLength(101)
    expect(gatedFiles(files)).toEqual([`${MODULE}/recordings/started.ndjson`])
  })
})

describe('a Provider checks run', () => {
  it('finds each recording it didn’t rewrite', () => {
    expect(
      unrewritten(
        [
          {file: 'a/recordings/old.ndjson', modified: 999},
          {file: 'a/recordings/new.ndjson', modified: 1000},
        ],
        1000
      )
    ).toEqual(['a/recordings/old.ndjson'])
  })
})
