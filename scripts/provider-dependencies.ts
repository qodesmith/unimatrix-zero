/**
 * Reads `docs/provider-dependencies.md` and the `[dep:<id>]` tags in test
 * names, which link an entry to its live check.
 */
export const LIST = 'docs/provider-dependencies.md'

const FIELDS = [
  'Id',
  'Kind',
  'Provider',
  'Relies on',
  'App side',
  'User would see',
  'Changed by',
  'Check',
] as const

type Field = (typeof FIELDS)[number]

const ALLOWED: Partial<Record<Field, RegExp>> = {
  Id: /^`[a-z\d]+(-[a-z\d]+)*`$/,
  Kind: /^(D|W|D\/W)$/,
  Provider: /^(Claude|Codex|both)$/,
  'Changed by': /^(upgrade|upgrade \+ drift)(\.|$)/,
}

const TAG = /\[dep:([^\]\s]*)\]/g
const REASON = /^none: \S/

export interface Entry {
  id: string
  title: string
  fields: Partial<Record<Field, string>>
}

export interface TestFile {
  file: string
  source: string
}

/** Each `### ` heading after the first `## Entries` heading is one entry. */
export function entriesOf(list: string): Entry[] {
  const [, below = ''] = list.split(/^## Entries$/m)

  return below
    .split(/^### /m)
    .slice(1)
    .map(block => {
      const [title = '', ...lines] = block.split('\n')
      const fields: Entry['fields'] = {}

      for (const line of lines) {
        const field = /^- \*\*(.+?):\*\* (.*)$/.exec(line)
        const name = FIELDS.find(known => known === field?.[1])

        if (name && field?.[2] !== undefined) fields[name] = field[2].trim()
      }

      return {id: (fields.Id ?? '').replaceAll('`', ''), title, fields}
    })
}

export function tagsIn(source: string) {
  return [...source.matchAll(TAG)].map(([, id = '']) => id)
}

/** The live check an entry's Check field names, or null for a reason. */
export function liveCheckOf(entry: Entry) {
  const check = entry.fields.Check ?? ''

  return REASON.test(check) ? null : (tagsIn(check)[0] ?? '')
}

function fieldProblems(entry: Entry) {
  return FIELDS.flatMap(field => {
    const value = entry.fields[field]

    if (value === undefined || value === '') {
      return [`${entry.title}: no **${field}:**`]
    }

    const allowed = ALLOWED[field]

    return allowed && !allowed.test(value)
      ? [`${entry.title}: **${field}:** can't be "${value}"`]
      : []
  })
}

function checkProblems(entry: Entry, tagged: Map<string, string[]>) {
  const live = liveCheckOf(entry)
  const files = tagged.get(entry.id)

  if (live === null) {
    return files
      ? [
          `${entry.id}: Check gives a reason, but ${files.join(', ')} has [dep:${entry.id}]`,
        ]
      : []
  }

  if (live === '') {
    return [
      `${entry.id}: Check names neither a live check nor "none: <reason>"`,
    ]
  }

  if (live !== entry.id) {
    return [`${entry.id}: Check names [dep:${live}], not [dep:${entry.id}]`]
  }

  return files ? [] : [`${entry.id}: no test is named [dep:${entry.id}]`]
}

/** What `bun run lint` reports about the list and the tests that tag it. */
export function problemsOf(list: string, tests: TestFile[]) {
  const entries = entriesOf(list)
  const ids = new Set(entries.map(entry => entry.id))
  const tagged = new Map<string, string[]>()

  for (const {file, source} of tests) {
    for (const id of new Set(tagsIn(source))) {
      tagged.set(id, [...(tagged.get(id) ?? []), file])
    }
  }

  const duplicates = entries.flatMap((entry, index) =>
    entries.slice(0, index).some(earlier => earlier.id === entry.id)
      ? [`${entry.id}: two entries share this id`]
      : []
  )

  const strays = [...tagged].flatMap(([id, files]) =>
    ids.has(id) ? [] : [`${files.join(', ')}: [dep:${id}] isn't in ${LIST}`]
  )

  const problems = entries.flatMap(entry =>
    fieldProblems(entry).concat(entry.id ? checkProblems(entry, tagged) : [])
  )

  return problems.concat(duplicates, strays)
}
