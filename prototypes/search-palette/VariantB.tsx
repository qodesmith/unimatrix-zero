import type {Lib} from '../tree-sidebar/common'

// PROTOTYPE variant B: Spotlight-style. A wide palette with results on the left in two sections, Trees (title matches)
// and Messages (every matching Turn its own row), and a preview of the selected match in its Exchange on the right.
// Filters are typed (in:School from:you with:chatgpt date:week title:). Opening marks every match in the Tree and
// shows a find bar to step through them. Throw away.
import {useEffect, useMemo, useState} from 'react'

import {pathTo, simCache} from '../canvas-mode-ux/tree'
import {displayTitle, relTime, stats} from '../tree-sidebar/library'
import {
  Kbd,
  marksStore,
  ModelPill,
  openResult,
  Parts,
  Providers,
  TreeIcon,
  useMarks,
  Who,
} from './common'
import {
  exchangeOf,
  getRecentQueries,
  matchText,
  NO_FILTERS,
  partsOf,
  recentEntries,
  search,
  snippet,
  termsOf,
  type Filters,
  type Hit,
  type Result,
} from './engine'

export const name = 'Trees and Messages, with preview'

// The last search, so "Back to results" reopens it.
let last = {chips: '', q: ''}

type Token = {
  key: 'in' | 'from' | 'with' | 'date' | 'title'
  raw: string
  label: string
}

function parse(q: string, collections: string[]) {
  const tokens: Token[] = []
  const words: string[] = []
  const f: Filters = {...NO_FILTERS}
  // A token counts once it's followed by a space, so typing "in:Sch" doesn't filter yet.
  const parts = q.split(/(\s+)/)
  parts.forEach((w, i) => {
    const done = i < parts.length - 1
    const m = /^(in|from|with|date|title):(.*)$/i.exec(w)
    if (!m || !done) return w.trim() && words.push(w)
    const key = m[1]!.toLowerCase() as Token['key']
    const v = m[2]!.toLowerCase()
    if (key === 'title') {
      f.titlesOnly = true
      tokens.push({key, raw: w, label: 'Titles only'})
    } else if (key === 'in') {
      const c = collections.find(c => c.toLowerCase().startsWith(v))
      if (c) {
        f.collection = c
        tokens.push({key, raw: w, label: `📁 ${c}`})
      }
    } else if (
      key === 'from' &&
      (v === 'you' || v === 'reply' || v === 'replies')
    ) {
      f.who = v === 'you' ? 'prompt' : 'reply'
      tokens.push({
        key,
        raw: w,
        label: v === 'you' ? 'From you' : 'From Replies',
      })
    } else if (
      key === 'with' &&
      (v.startsWith('claude') || v.startsWith('chatgpt') || v === 'gpt')
    ) {
      f.provider = v.startsWith('claude') ? 'claude' : 'chatgpt'
      tokens.push({
        key,
        raw: w,
        label: f.provider === 'claude' ? 'Used Claude' : 'Used ChatGPT',
      })
    } else if (key === 'date' && ['today', 'week', 'month'].includes(v)) {
      f.date = v as Filters['date']
      tokens.push({
        key,
        raw: w,
        label: {today: 'Today', week: 'Past 7 days', month: 'Past 30 days'}[v]!,
      })
    } else words.push(w)
  })
  return {text: words.join(' '), tokens, filters: f}
}

type Item =
  | {kind: 'tree'; r: Result}
  | {kind: 'msg'; r: Result; hit: Hit}
  | {kind: 'recent'; r: Result}
  | {kind: 'query'; q: string}

export function Palette({lib, onClose}: {lib: Lib; onClose: () => void}) {
  // Typed filters become chips once followed by a space; `chips` keeps their raw text.
  const [chips, setChips] = useState(last.chips)
  const [q, setQ] = useState(last.q)
  const [i, setI] = useState(0)
  const {text, filters} = parse(chips + q, lib.collections)
  const tokens = parse(chips, lib.collections).tokens
  const type = (value: string) => {
    const p = parse(value, lib.collections)
    if (p.tokens.length) {
      setChips(c => c + p.tokens.map(t => t.raw + ' ').join(''))
      setQ(p.text && /\s$/.test(value) ? p.text + ' ' : p.text)
    } else setQ(value)
    setI(0)
  }
  const results = useMemo(
    () => search(lib.entries, text, filters),
    [text, JSON.stringify(filters), lib.entries]
  )
  const trees: Item[] = results
    .filter(r => r.titleRanges)
    .map(r => ({kind: 'tree', r}))
  const msgs: Item[] = results
    .flatMap(r => r.hits.map(hit => ({kind: 'msg' as const, r, hit})))
    .slice(0, 60)
  const empty = !text.trim()
  const recents: Item[] = empty
    ? [
        ...getRecentQueries().map(q => ({kind: 'query' as const, q})),
        ...recentEntries(lib.entries, 6).map(entry => ({
          kind: 'recent' as const,
          r: {entry, titleRanges: null, hits: [], score: 0},
        })),
      ]
    : []
  const items = empty ? recents : [...trees, ...msgs]
  useEffect(
    () => setI(x => Math.min(x, Math.max(0, items.length - 1))),
    [items.length]
  )
  const sel = items[i]

  const open = (it: Item | undefined) => {
    if (!it) return
    if (it.kind === 'query') {
      type(it.q + ' ')
      return
    }
    last = {chips, q}
    openResult(
      lib,
      it.r,
      it.kind === 'msg' ? it.hit.turn.id : null,
      text,
      'all'
    )
    onClose()
  }

  const section = (
    label: string,
    list: Item[],
    offset: number,
    total?: number
  ) =>
    list.length > 0 && (
      <div className="mb-1">
        <div className="flex px-2.5 pt-2 pb-1 text-[11px] font-medium text-zinc-400">
          {label}
          {total !== undefined && total > list.length && (
            <span className="ml-auto font-normal">
              first {list.length} of {total}
            </span>
          )}
        </div>
        {list.map((it, k) => (
          <ItemRow
            key={k}
            it={it}
            selected={offset + k === i}
            onHover={() => setI(offset + k)}
            onOpen={() => open(it)}
          />
        ))}
      </div>
    )
  const totalMsgs = results.reduce((n, r) => n + r.hits.length, 0)

  return (
    <div
      className="fixed inset-0 z-[65] flex justify-center bg-black/25 pt-[9vh]"
      onClick={onClose}
    >
      <div
        className="flex h-[76vh] w-[960px] max-w-[94vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
          <span className="text-zinc-400">🔍</span>
          {tokens.map((t, k) => (
            <span
              key={k}
              className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
            >
              {t.label}
            </span>
          ))}
          <input
            autoFocus
            value={q}
            onChange={e => type(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'Backspace' && !q && tokens.length) {
                e.preventDefault()
                setChips(
                  tokens
                    .slice(0, -1)
                    .map(t => t.raw + ' ')
                    .join('')
                )
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setI(x => Math.min(items.length - 1, x + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setI(x => Math.max(0, x - 1))
              } else if (e.key === 'Enter') open(sel)
            }}
            placeholder="Search Trees · try in:School from:you with:chatgpt date:week title:"
            className="min-w-60 flex-1 py-0.5 text-sm outline-none"
          />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-[46%] min-w-0 overflow-y-auto border-r border-zinc-100 p-1.5">
            {empty ? (
              <>
                {section(
                  'Recent searches',
                  recents.filter(x => x.kind === 'query'),
                  0
                )}
                {section(
                  'Recent Trees',
                  recents.filter(x => x.kind === 'recent'),
                  recents.filter(x => x.kind === 'query').length
                )}
              </>
            ) : items.length ? (
              <>
                {section('Trees', trees, 0)}
                {section('Messages', msgs, trees.length, totalMsgs)}
              </>
            ) : (
              <p className="p-4 text-sm text-zinc-400">
                Nothing matches “{text.trim()}”
                {tokens.length ? ' with these filters' : ''}.
              </p>
            )}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto bg-zinc-50/60">
            {empty && !sel ? (
              <Cheatsheet />
            ) : sel ? (
              <Preview it={sel} text={text} />
            ) : null}
            {empty && sel && <Cheatsheet />}
          </div>
        </div>
        <div className="flex gap-3 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move, preview follows
          </span>
          <span>
            <Kbd>Enter</Kbd> open, every match in that Tree marked
          </span>
          <span className="ml-auto">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

function ItemRow({
  it,
  selected,
  onHover,
  onOpen,
}: {
  it: Item
  selected: boolean
  onHover: () => void
  onOpen: () => void
}) {
  const cls = `flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${selected ? 'bg-sky-600 text-white' : 'text-zinc-700'}`
  if (it.kind === 'query')
    return (
      <button
        onMouseMove={onHover}
        onClick={onOpen}
        className={`${cls} text-sm`}
      >
        <span className="w-4 text-center text-xs opacity-60">↺</span>
        <span className="truncate">{it.q}</span>
      </button>
    )
  const e = it.r.entry
  if (it.kind === 'recent' || it.kind === 'tree')
    return (
      <button
        onMouseMove={onHover}
        onClick={onOpen}
        className={`${cls} text-sm`}
      >
        <TreeIcon entry={e} />
        <span className="min-w-0 flex-1 truncate">
          {it.r.titleRanges ? (
            <Parts parts={partsOf(displayTitle(e), it.r.titleRanges)} />
          ) : (
            displayTitle(e)
          )}
        </span>
        {e.collection && (
          <span className="text-[11px] opacity-60">📁 {e.collection}</span>
        )}
      </button>
    )
  const h = it.hit
  return (
    <button
      onMouseMove={onHover}
      onClick={onOpen}
      className={`${cls} items-start text-xs`}
    >
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2">
          <Who turn={h.turn} />
          {h.field === 'attachment' ? (
            <>
              📎 <Parts parts={partsOf(h.attachment!, h.ranges)} />
            </>
          ) : (
            <Parts parts={snippet(h.turn.text, h.ranges, 30, 140)} />
          )}
        </span>
        <span
          className={`mt-0.5 block truncate text-[11px] ${selected ? 'text-sky-100' : 'text-zinc-400'}`}
        >
          {displayTitle(e)}
          {e.collection && ` · 📁 ${e.collection}`}
        </span>
      </span>
    </button>
  )
}

function Preview({it, text}: {it: Item; text: string}) {
  if (it.kind === 'query') return null
  const e = it.r.entry
  const tree = simCache.get(e.key)?.tree ?? {}
  const st = stats(e.key)
  const head = (
    <div className="mb-3 flex items-center gap-2 text-sm">
      <TreeIcon entry={e} />
      <span className="min-w-0 truncate font-medium text-zinc-800">
        {displayTitle(e)}
      </span>
      {e.collection && (
        <span className="text-[11px] text-zinc-400">📁 {e.collection}</span>
      )}
      <Providers entry={e} />
      <span className="ml-auto text-[11px] text-zinc-400">
        active {relTime(e.lastActive)}
      </span>
    </div>
  )
  if (it.kind !== 'msg') {
    const root = Object.values(tree).find(t => !t.parentId)
    return (
      <div className="p-5">
        {head}
        <p className="mb-3 text-xs text-zinc-500">
          {st.turns} Turns · {st.forks} Forks · created {relTime(e.created)} ago
        </p>
        {root && (
          <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950">
            <div className="mb-1 text-[10px] tracking-wide text-sky-700/60 uppercase">
              First Prompt
            </div>
            <span className="line-clamp-6 whitespace-pre-wrap">
              {root.text}
            </span>
          </div>
        )}
      </div>
    )
  }
  const turn = it.hit.turn
  const path = pathTo(tree, turn.id)
  const at = path.findIndex(t => t.id === turn.id)
  // The Exchange around the match: its Prompt and Reply, plus the Reply before it, faded.
  const promptIdx = turn.kind === 'prompt' ? at : at - 1
  const show = path.slice(Math.max(0, promptIdx - 1), promptIdx + 2)
  const terms = termsOf(text)
  return (
    <div className="p-5">
      {head}
      <p className="mb-3 text-[11px] text-zinc-400">
        Exchange {exchangeOf(tree, turn)} of this Thread
        {it.r.hits.length > 1 && ` · ${it.r.hits.length} matches in this Tree`}
      </p>
      <div className="flex flex-col gap-2">
        {show.map(t => {
          const r = matchText(t.text, terms)
          const faded = promptIdx > 0 && t.id === path[promptIdx - 1]?.id
          return (
            <div
              key={t.id}
              className={`rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${t.kind === 'prompt' ? 'ml-10 bg-sky-100 text-sky-950' : 'mr-6 border border-zinc-200 bg-white text-zinc-800'} ${faded ? 'line-clamp-3 opacity-40' : ''}`}
            >
              {t.kind === 'reply' && (
                <div className="mb-1">
                  <ModelPill turn={t} />
                </div>
              )}
              {r && !faded ? <Parts parts={partsOf(t.text, r)} /> : t.text}
              {it.hit.field === 'attachment' && t.id === turn.id && (
                <div className="mt-1 text-xs">
                  📎{' '}
                  <Parts parts={partsOf(it.hit.attachment!, it.hit.ranges)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Cheatsheet() {
  const rows: [string, string][] = [
    ['in:School', 'only Trees in that Collection'],
    ['from:you', 'only your Prompts (from:reply for Replies)'],
    ['with:chatgpt', 'only Trees that used ChatGPT (or with:claude)'],
    [
      'date:week',
      'active today, this week or this month (date:today, date:month)',
    ],
    ['title:', 'titles only'],
  ]
  return (
    <div className="p-5 text-xs text-zinc-500">
      <div className="mb-2 font-medium text-zinc-600">Narrow it down</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 py-1">
          <code className="w-24 shrink-0 rounded bg-white px-1.5 py-0.5 text-zinc-700 ring-1 ring-zinc-200">
            {k}
          </code>
          <span>{v}</span>
        </div>
      ))}
      <p className="mt-3 text-zinc-400">
        Every word has to appear, matched from the start of a word: “pgbounc”
        finds PgBouncer, “cafe” finds café.
      </p>
    </div>
  )
}

// The find bar: step through every match in the open Tree, or go back to the results.
export function Overlay({lib, reopen}: {lib: Lib; reopen: () => void}) {
  const m = useMarks()
  const step = (d: number) => {
    if (!m) return
    const index = (m.index + d + m.turnIds.length) % m.turnIds.length
    marksStore.set({...m, index})
    lib.pick(m.treeKey, m.turnIds[index]!)
  }
  useEffect(() => {
    if (!m) return
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
      }
      if (e.key === 'Escape') marksStore.set(null)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  if (!m || m.treeKey !== lib.current) return null
  return (
    <div className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-200 bg-white py-1 pr-1 pl-3 text-xs text-zinc-600 shadow-lg">
      <span className="text-zinc-400">🔍</span>
      <span className="font-medium text-zinc-800">“{m.query}”</span>
      <span className="px-1 tabular-nums">
        {m.index + 1} of {m.turnIds.length} in this Tree
      </span>
      <button
        title="Previous (⇧⌘G)"
        onClick={() => step(-1)}
        className="rounded-full px-1.5 hover:bg-zinc-100"
      >
        ‹
      </button>
      <button
        title="Next (⌘G)"
        onClick={() => step(1)}
        className="rounded-full px-1.5 hover:bg-zinc-100"
      >
        ›
      </button>
      <button
        onClick={reopen}
        className="rounded-full px-2 py-0.5 hover:bg-zinc-100"
      >
        Back to results
      </button>
      <button
        title="Clear (Esc)"
        onClick={() => marksStore.set(null)}
        className="rounded-full px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
      >
        ✕
      </button>
    </div>
  )
}
