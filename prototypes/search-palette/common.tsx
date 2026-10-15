// PROTOTYPE: pieces shared by the ⌘K palette variants (#44): the "marks" store that highlights matches after a result
// opens, marked text for the canvas and slideout, and small result bits. Throw away.
import {useEffect, useRef, useSyncExternalStore, type ReactNode} from 'react'

import {simCache, type Turn} from '../canvas-mode-ux/tree'
import {TreeIcon, type Lib} from '../tree-sidebar/common'
import {stats, type Entry} from '../tree-sidebar/library'
import {
  matchText,
  noteOpened,
  noteQuery,
  partsOf,
  termsOf,
  type Part,
  type Result,
} from './engine'

// ---------- marks: what's highlighted on the canvas and in the slideout ----------

export type Marks = {
  treeKey: string
  query: string
  // Turns with a match, in Thread order; `index` is the one the user is on.
  turnIds: string[]
  index: number
  // one = only the opened Turn is marked; all = every match in the Tree, the current one stronger.
  mode: 'one' | 'all'
}

let marks: Marks | null = null
const subs = new Set<() => void>()
export const marksStore = {
  get: () => marks,
  set: (m: Marks | null) => {
    marks = m
    subs.forEach(f => f())
  },
  subscribe: (f: () => void) => {
    subs.add(f)
    return () => void subs.delete(f)
  },
}
export const useMarks = () =>
  useSyncExternalStore(marksStore.subscribe, marksStore.get)

// Scroll only the nearest scrolling box (a long message, the slideout), never the canvas pane.
function scrollWithin(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
      const top =
        el.getBoundingClientRect().top -
        p.getBoundingClientRect().top +
        p.scrollTop
      p.scrollTo({top: top - p.clientHeight / 3, behavior: 'smooth'})
      return
    }
  }
}

export function MarkedText({
  treeKey,
  turn,
  where,
}: {
  treeKey: string
  turn: Turn
  where: 'canvas' | 'drawer'
}) {
  const m = useMarks()
  const first = useRef<HTMLElement>(null)
  const on = m && m.treeKey === treeKey && m.turnIds.includes(turn.id)
  const current = on && m.turnIds[m.index] === turn.id
  const shown = on && (m.mode === 'all' || current)
  useEffect(() => {
    if (!current || !first.current) return
    const el = first.current
    const t = setTimeout(() => scrollWithin(el), where === 'drawer' ? 450 : 50)
    return () => clearTimeout(t)
  }, [current, m?.index, m?.query])
  if (!shown) return <>{turn.text}</>
  const ranges = matchText(turn.text, termsOf(m.query))
  if (!ranges) return <>{turn.text}</>
  let firstSeen = false
  return (
    <>
      {partsOf(turn.text, ranges).map((p, i) => {
        if (!p.hit) return <span key={i}>{p.text}</span>
        const isFirst = !firstSeen
        firstSeen = true
        return (
          <mark
            key={i}
            ref={isFirst ? first : undefined}
            className={`rounded-sm text-zinc-900 ${current ? 'bg-amber-300 ring-1 ring-amber-500' : 'bg-amber-100'}`}
          >
            {p.text}
          </mark>
        )
      })}
    </>
  )
}

// ---------- result bits ----------

export function Parts({
  parts,
  className = '',
}: {
  parts: Part[]
  className?: string
}) {
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-amber-200 text-zinc-900">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}

export function Who({turn}: {turn: Turn}) {
  return (
    <span className="mr-1.5 shrink-0 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
      {turn.kind === 'prompt' ? 'You' : 'Reply'}
    </span>
  )
}

export function ModelPill({turn}: {turn: Turn}) {
  if (turn.kind !== 'reply') return null
  const gpt = turn.model?.startsWith('GPT')
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] whitespace-nowrap ${gpt ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}
    >
      {turn.model ?? 'Claude'}
    </span>
  )
}

export function Providers({entry}: {entry: Entry}) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {stats(entry.key).providers.map(p => (
        <span
          key={p}
          title={p === 'claude' ? 'Claude' : 'ChatGPT'}
          className={`size-1.5 rounded-full ${p === 'claude' ? 'bg-orange-400' : 'bg-emerald-500'}`}
        />
      ))}
    </span>
  )
}

export {TreeIcon}

export function Kbd({children}: {children: ReactNode}) {
  return (
    <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 font-sans text-[10px] text-zinc-500">
      {children}
    </kbd>
  )
}

// A small dropdown chip for one filter.
export function Chip({
  label,
  active,
  onClick,
  children,
}: {
  label: ReactNode
  active?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <span className="relative">
      <button
        onClick={onClick}
        className={`rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
      >
        {label}
      </button>
      {children}
    </span>
  )
}

export const turnOf = (key: string, id: string) => simCache.get(key)?.tree[id]

// Opens the Tree; with a Turn, the slideout opens on it and the matches are marked.
export function openResult(
  lib: Lib,
  r: Result | {entry: Entry; hits: Result['hits']},
  turnId: string | null,
  query: string,
  mode: Marks['mode']
) {
  noteOpened(r.entry.key)
  noteQuery(query)
  const turnIds = [
    ...new Set(r.hits.filter(h => h.field === 'text').map(h => h.turn.id)),
  ]
  if (turnId && !turnIds.includes(turnId)) turnIds.push(turnId)
  marksStore.set(
    turnId
      ? {
          treeKey: r.entry.key,
          query,
          turnIds,
          index: turnIds.indexOf(turnId),
          mode,
        }
      : null
  )
  lib.pick(r.entry.key, turnId)
}
