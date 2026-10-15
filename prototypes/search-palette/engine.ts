// PROTOTYPE: search for the ⌘K palette ticket (#44). Stands in for SQLite FTS5 with `unicode61 remove_diacritics 2`:
// each typed word must match the start of a word ("pgbounc" → PgBouncer, "cafe" → café), every word must appear in
// the same Turn (or title), and queries under 3 characters fall back to a plain substring scan. Throw away.
import {simCache, type Tree, type Turn} from '../canvas-mode-ux/tree'
import {displayTitle, stats, type Entry} from '../tree-sidebar/library'

export type Range = [start: number, end: number]
export type Part = {text: string; hit: boolean}

export type Hit = {
  turn: Turn
  // Where the match is: the Turn's text, or one of its attachment names.
  field: 'text' | 'attachment'
  attachment?: string
  ranges: Range[]
}

export type Result = {
  entry: Entry
  titleRanges: Range[] | null
  hits: Hit[]
  score: number
}

export type Filters = {
  titlesOnly: boolean
  who: 'all' | 'prompt' | 'reply'
  collection: string | null | undefined // undefined = any, null = not in a Collection
  provider: 'any' | 'claude' | 'chatgpt'
  date: 'any' | 'today' | 'week' | 'month'
}

export const NO_FILTERS: Filters = {
  titlesOnly: false,
  who: 'all',
  collection: undefined,
  provider: 'any',
  date: 'any',
}

export type Sort = 'best' | 'active' | 'created'
export const SORTS: Record<Sort, string> = {
  best: 'Best match',
  active: 'Last active',
  created: 'Date created',
}

// Lowercased, accents stripped, with a map back to the original string's indexes.
function fold(s: string) {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    const f = s[i]!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    for (let j = 0; j < f.length; j++) map.push(i)
    out += f
  }
  map.push(s.length)
  return {out, map}
}

const WORD = /[\p{L}\p{N}]/u

export const termsOf = (q: string) =>
  fold(q.trim()).out.split(/\s+/).filter(Boolean)

// Every term must match; returns all ranges, or null if any term is missing.
export function matchText(text: string, terms: string[]): Range[] | null {
  if (!terms.length) return null
  const {out, map} = fold(text)
  const short = terms.join('').length < 3
  const ranges: Range[] = []
  for (const t of terms) {
    let found = false
    let at = out.indexOf(t)
    while (at >= 0) {
      if (short || at === 0 || !WORD.test(out[at - 1]!)) {
        ranges.push([map[at]!, map[at + t.length]!])
        found = true
      }
      at = out.indexOf(t, at + 1)
    }
    if (!found) return null
  }
  return ranges.sort((a, b) => a[0] - b[0])
}

export function partsOf(text: string, ranges: Range[]): Part[] {
  const parts: Part[] = []
  let i = 0
  for (const [s, e] of ranges) {
    if (s < i) continue
    if (s > i) parts.push({text: text.slice(i, s), hit: false})
    parts.push({text: text.slice(s, e), hit: true})
    i = e
  }
  if (i < text.length) parts.push({text: text.slice(i), hit: false})
  return parts
}

// A window of the text around the first match, cut at word boundaries.
export function snippet(
  text: string,
  ranges: Range[],
  before = 50,
  after = 110
): Part[] {
  const first = ranges[0]![0]
  let start = Math.max(0, first - before)
  let end = Math.min(text.length, first + after)
  if (start > 0) start = text.indexOf(' ', start) + 1 || start
  if (end < text.length) end = text.lastIndexOf(' ', end) || end
  const inside = ranges
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]) => [s - start, e - start] as Range)
  const parts = partsOf(text.slice(start, end), inside)
  if (start > 0) parts.unshift({text: '…', hit: false})
  if (end < text.length) parts.push({text: '…', hit: false})
  return parts
}

export const providerOfTurn = (t: Turn) =>
  t.model?.startsWith('GPT') ? 'chatgpt' : 'claude'

const DAY = 86_400_000
const within = (t: number, date: Filters['date']) =>
  date === 'any' ||
  Date.now() - t <
    (date === 'today' ? DAY : date === 'week' ? 7 * DAY : 30 * DAY)

export function search(
  entries: Entry[],
  q: string,
  filters: Filters = NO_FILTERS,
  sort: Sort = 'best'
): Result[] {
  const terms = termsOf(q)
  if (!terms.length) return []
  const out: Result[] = []
  for (const entry of entries) {
    if (
      filters.collection !== undefined &&
      entry.collection !== filters.collection
    )
      continue
    if (!within(entry.lastActive, filters.date)) continue
    if (
      filters.provider !== 'any' &&
      !stats(entry.key).providers.includes(filters.provider)
    )
      continue
    const titleRanges = matchText(displayTitle(entry), terms)
    const hits: Hit[] = []
    if (!filters.titlesOnly) {
      const tree: Tree = simCache.get(entry.key)?.tree ?? {}
      const turns = Object.values(tree).sort(
        (a, b) => a.createdAt - b.createdAt
      )
      for (const turn of turns) {
        if (filters.who !== 'all' && turn.kind !== filters.who) continue
        const r = matchText(turn.text, terms)
        if (r) hits.push({turn, field: 'text', ranges: r})
        for (const a of turn.attachments ?? []) {
          const ar = matchText(a.name, terms)
          if (ar)
            hits.push({
              turn,
              field: 'attachment',
              attachment: a.name,
              ranges: ar,
            })
        }
      }
    }
    if (!titleRanges && !hits.length) continue
    // Titles above content (like Notion), then how often it matches, then a nudge for recent activity.
    const ageDays = (Date.now() - entry.lastActive) / DAY
    const score =
      (titleRanges ? 100 : 0) +
      Math.min(30, 8 * Math.log2(1 + hits.length)) +
      20 / (1 + ageDays)
    out.push({entry, titleRanges, hits, score})
  }
  return out.sort((a, b) =>
    sort === 'active'
      ? b.entry.lastActive - a.entry.lastActive
      : sort === 'created'
        ? b.entry.created - a.entry.created
        : b.score - a.score
  )
}

// ---------- recents (Notion and VS Code both open on these) ----------

const recent: string[] = []
const recentQueries: string[] = []

export function noteOpened(key: string) {
  const i = recent.indexOf(key)
  if (i >= 0) recent.splice(i, 1)
  recent.unshift(key)
}

export function noteQuery(q: string) {
  const t = q.trim()
  if (t.length < 2) return
  const i = recentQueries.indexOf(t)
  if (i >= 0) recentQueries.splice(i, 1)
  recentQueries.unshift(t)
  recentQueries.length = Math.min(recentQueries.length, 5)
}

// Opened from search first, then the rest by last activity.
export function recentEntries(entries: Entry[], n = 8) {
  const byKey = new Map(entries.map(e => [e.key, e]))
  const first = recent.map(k => byKey.get(k)).filter((e): e is Entry => !!e)
  const rest = [...entries]
    .filter(e => !recent.includes(e.key))
    .sort((a, b) => b.lastActive - a.lastActive)
  return [...first, ...rest].slice(0, n)
}

export const getRecentQueries = () => recentQueries

// Which Exchange (Prompt + Reply) of its Thread the Turn sits in, counted from the root.
export function exchangeOf(tree: Tree, turn: Turn) {
  let n = 0
  for (
    let t: Turn | undefined = turn;
    t;
    t = t.parentId ? tree[t.parentId] : undefined
  )
    if (t.kind === 'prompt') n++
  return n
}
