// PROTOTYPE variant C: live preview, like VS Code's ⌘P or Go to Symbol. A compact palette docked top-left with no dimming;
// moving through results switches the canvas behind it to that Tree and opens the slideout on the match. Enter (or
// clicking away) stays there; Esc puts you back where you were. Tabs pick what's searched; This Tree narrows to the
// Tree you started in. No recents: empty is just hints. Throw away.
import {useEffect, useMemo, useRef, useState} from 'react'

import {CLOSE_SLIDEOUT, type Lib} from '../tree-sidebar/common'
import {displayTitle, relTime} from '../tree-sidebar/library'
import {
  Kbd,
  marksStore,
  ModelPill,
  openResult,
  Parts,
  TreeIcon,
  Who,
} from './common'
import {
  NO_FILTERS,
  partsOf,
  search,
  snippet,
  type Filters,
  type Hit,
  type Result,
} from './engine'

export const name = 'Live preview behind the palette'

type Tab = 'all' | 'titles' | 'you' | 'replies'
const TABS: Record<Tab, string> = {
  all: 'Everything',
  titles: 'Titles',
  you: 'Your Prompts',
  replies: 'Replies',
}
const filtersFor = (t: Tab): Filters => ({
  ...NO_FILTERS,
  titlesOnly: t === 'titles',
  who: t === 'you' ? 'prompt' : t === 'replies' ? 'reply' : 'all',
})

type Row = {r: Result; hit: Hit | null}

export function Palette({lib, onClose}: {lib: Lib; onClose: () => void}) {
  const start = useRef(lib.current)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [thisTree, setThisTree] = useState(false)
  const [i, setI] = useState(0)
  const [more, setMore] = useState<string[]>([])
  const results = useMemo(
    () =>
      search(
        thisTree
          ? lib.entries.filter(e => e.key === start.current)
          : lib.entries,
        q,
        filtersFor(tab)
      ),
    [q, tab, thisTree, lib.entries]
  )
  const groups = results.map(r => {
    const all = r.hits.length ? r.hits : [null]
    const shown = more.includes(r.entry.key) ? all : all.slice(0, 3)
    return {
      r,
      rows: shown.map(hit => ({r, hit})) as Row[],
      hidden: all.length - shown.length,
    }
  })
  const rows = groups.flatMap(g => g.rows)
  const sel = rows[i]
  useEffect(
    () => setI(x => Math.min(x, Math.max(0, rows.length - 1))),
    [rows.length]
  )

  // Preview follows the selection, a beat after it settles.
  const previewed = useRef(false)
  useEffect(() => {
    if (!sel) return
    const t = setTimeout(() => {
      previewed.current = true
      openResult(lib, sel.r, sel.hit?.turn.id ?? null, q, 'one')
    }, 180)
    return () => clearTimeout(t)
  }, [sel?.r.entry.key, sel?.hit?.turn.id, q])

  const keep = () => onClose()
  const cancel = () => {
    if (previewed.current) {
      marksStore.set(null)
      lib.pick(start.current, CLOSE_SLIDEOUT)
    }
    onClose()
  }

  let n = -1
  return (
    <div className="fixed inset-0 z-[65]" onClick={keep}>
      <div
        className="absolute top-12 left-3 flex max-h-[78vh] w-[540px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur"
        onClick={e => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={e => {
            setQ(e.target.value)
            setI(0)
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') cancel()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI(x => Math.min(rows.length - 1, x + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI(x => Math.max(0, x - 1))
            } else if (e.key === 'Tab') {
              e.preventDefault()
              const keys = Object.keys(TABS) as Tab[]
              const k = keys.indexOf(tab) + (e.shiftKey ? -1 : 1)
              setTab(keys[(k + keys.length) % keys.length]!)
              setI(0)
            } else if (e.key === 'Enter') {
              if (sel)
                openResult(lib, sel.r, sel.hit?.turn.id ?? null, q, 'one')
              keep()
            }
          }}
          placeholder={thisTree ? 'Search this Tree' : 'Search every Tree'}
          className="border-b border-zinc-100 px-3.5 py-2.5 text-sm outline-none"
        />
        <div className="flex items-center gap-0.5 border-b border-zinc-100 px-2 py-1.5">
          {(Object.keys(TABS) as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setI(0)
              }}
              className={`rounded-md px-2 py-0.5 text-[11px] ${tab === t ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
            >
              {TABS[t]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={thisTree}
              onChange={e => {
                setThisTree(e.target.checked)
                setI(0)
              }}
            />
            This Tree only
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!q.trim() && (
            <div className="space-y-1.5 px-3.5 py-3 text-xs text-zinc-400">
              <p>
                Type to search. Results preview behind this box as you move
                through them.
              </p>
              <p>
                <Kbd>Tab</Kbd> switches between Everything, Titles, Your Prompts
                and Replies.
              </p>
              <p>
                <Kbd>Enter</Kbd> stays on the result. <Kbd>Esc</Kbd> goes back
                to where you were.
              </p>
            </div>
          )}
          {q.trim() && !rows.length && (
            <p className="px-3.5 py-3 text-sm text-zinc-400">
              Nothing in {thisTree ? 'this Tree' : 'any Tree'} matches “
              {q.trim()}”.
            </p>
          )}
          {groups.map(g => (
            <div key={g.r.entry.key} className="mb-1">
              <div className="flex items-center gap-2 px-3.5 pt-1.5 pb-0.5 text-[11px] text-zinc-500">
                <TreeIcon entry={g.r.entry} />
                <span className="min-w-0 truncate font-medium text-zinc-700">
                  {g.r.titleRanges ? (
                    <Parts
                      parts={partsOf(displayTitle(g.r.entry), g.r.titleRanges)}
                    />
                  ) : (
                    displayTitle(g.r.entry)
                  )}
                </span>
                {g.r.entry.collection && <span>📁 {g.r.entry.collection}</span>}
                <span className="ml-auto">
                  {g.r.hits.length > 0 && `${g.r.hits.length} · `}
                  {relTime(g.r.entry.lastActive)}
                </span>
              </div>
              {g.rows.map(row => {
                n++
                const me = n
                const h = row.hit
                return (
                  <button
                    key={h ? `${h.turn.id}-${h.attachment ?? ''}` : 'title'}
                    onMouseMove={() => setI(me)}
                    onClick={() => {
                      openResult(lib, row.r, h?.turn.id ?? null, q, 'one')
                      keep()
                    }}
                    className={`mx-1.5 block w-[calc(100%-12px)] cursor-default rounded-md border-l-2 px-3 py-1 text-left text-xs ${i === me ? 'border-sky-500 bg-sky-50' : 'border-transparent'}`}
                  >
                    {h ? (
                      <>
                        <span className="mb-0.5 flex items-center gap-1">
                          <Who turn={h.turn} />
                          <ModelPill turn={h.turn} />
                        </span>
                        <span className="line-clamp-2 text-zinc-600">
                          {h.field === 'attachment' ? (
                            <>
                              📎{' '}
                              <Parts parts={partsOf(h.attachment!, h.ranges)} />
                            </>
                          ) : (
                            <Parts
                              parts={snippet(h.turn.text, h.ranges, 40, 170)}
                            />
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-400">
                        Title match · opens the Tree
                      </span>
                    )}
                  </button>
                )
              })}
              {g.hidden > 0 && (
                <button
                  onClick={() => setMore(m => [...m, g.r.entry.key])}
                  className="px-4 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-700"
                >
                  +{g.hidden} more
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3 border-t border-zinc-100 px-3.5 py-1.5 text-[11px] text-zinc-400">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> preview
          </span>
          <span>
            <Kbd>Tab</Kbd> what to search
          </span>
          <span>
            <Kbd>Enter</Kbd> stay
          </span>
          <span className="ml-auto">
            <Kbd>Esc</Kbd> go back
          </span>
        </div>
      </div>
    </div>
  )
}
