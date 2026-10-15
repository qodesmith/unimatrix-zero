import type {Lib} from '../tree-sidebar/common'

// PROTOTYPE variant A: like Notion's search. Empty = recent Trees. One row per Tree with its best snippet, ranked
// titles first then recent; → expands a Tree to every match. Filter chips and a sort under the input. Enter opens the
// Tree with the slideout on that Turn and only that Turn's matches marked. Throw away.
import {useEffect, useMemo, useState} from 'react'

import {Menu} from '../export-archive-summary/common'
import {displayTitle, relTime, type Entry} from '../tree-sidebar/library'
import {
  Chip,
  Kbd,
  ModelPill,
  openResult,
  Parts,
  Providers,
  TreeIcon,
  Who,
} from './common'
import {
  NO_FILTERS,
  partsOf,
  recentEntries,
  search,
  snippet,
  SORTS,
  type Filters,
  type Hit,
  type Result,
  type Sort,
} from './engine'

export const name = 'One row per Tree (Notion)'

type Row =
  | {kind: 'recent'; entry: Entry}
  | {kind: 'tree'; r: Result}
  | {kind: 'hit'; r: Result; hit: Hit}

const best = (r: Result) =>
  r.hits.find(h => h.field === 'text' && h.turn.kind === 'reply') ?? r.hits[0]

export function Palette({lib, onClose}: {lib: Lib; onClose: () => void}) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<Sort>('best')
  const [expanded, setExpanded] = useState<string[]>([])
  const [menu, setMenu] = useState<
    null | 'collection' | 'provider' | 'date' | 'sort'
  >(null)
  const results = useMemo(
    () => search(lib.entries, q, filters, sort),
    [q, filters, sort, lib.entries]
  )
  const rows: Row[] = q.trim()
    ? results.flatMap<Row>(r => [
        {kind: 'tree', r},
        ...(expanded.includes(r.entry.key)
          ? r.hits.map(hit => ({kind: 'hit' as const, r, hit}))
          : []),
      ])
    : recentEntries(lib.entries).map(entry => ({kind: 'recent', entry}))
  useEffect(
    () => setI(x => Math.min(x, Math.max(0, rows.length - 1))),
    [rows.length]
  )

  const open = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'recent') {
      openResult(lib, {entry: row.entry, hits: []}, null, '', 'one')
    } else if (row.kind === 'tree') {
      openResult(lib, row.r, best(row.r)?.turn.id ?? null, q, 'one')
    } else openResult(lib, row.r, row.hit.turn.id, q, 'one')
    onClose()
  }
  const toggle = (key: string, on?: boolean) =>
    setExpanded(xs =>
      (on ?? !xs.includes(key))
        ? [...xs.filter(x => x !== key), key]
        : xs.filter(x => x !== key)
    )
  const set = (p: Partial<Filters>) => {
    setFilters(f => ({...f, ...p}))
    setI(0)
  }

  return (
    <div
      className="fixed inset-0 z-[65] flex justify-center bg-black/20 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[72vh] w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4">
          <span className="text-zinc-400">🔍</span>
          <input
            autoFocus
            value={q}
            onChange={e => {
              setQ(e.target.value)
              setI(0)
            }}
            onKeyDown={e => {
              const row = rows[i]
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setI(x => Math.min(rows.length - 1, x + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setI(x => Math.max(0, x - 1))
              } else if (
                e.key === 'ArrowRight' &&
                row?.kind === 'tree' &&
                row.r.hits.length > 1
              ) {
                e.preventDefault()
                toggle(row.r.entry.key, true)
              } else if (
                e.key === 'ArrowLeft' &&
                row &&
                row.kind !== 'recent'
              ) {
                if (row.kind === 'hit' || expanded.includes(row.r.entry.key)) {
                  e.preventDefault()
                  toggle(row.r.entry.key, false)
                  setI(rows.findIndex(x => x.kind === 'tree' && x.r === row.r))
                }
              } else if (e.key === 'Enter') open(row)
            }}
            placeholder="Search Trees"
            className="flex-1 py-3 text-sm outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
          <Chip
            label="Titles only"
            active={filters.titlesOnly}
            onClick={() => set({titlesOnly: !filters.titlesOnly})}
          />
          <Chip
            label={
              filters.collection === undefined
                ? '📁 Collection ▾'
                : `📁 ${filters.collection ?? 'Not in a Collection'}`
            }
            active={filters.collection !== undefined}
            onClick={() => setMenu('collection')}
          >
            {menu === 'collection' && (
              <Menu
                onClose={() => setMenu(null)}
                className="absolute top-full left-0 mt-1"
                items={[
                  {
                    label: 'Any Collection',
                    onClick: () => set({collection: undefined}),
                  },
                  'sep',
                  ...lib.collections.map(c => ({
                    label: `📁 ${c}`,
                    onClick: () => set({collection: c}),
                  })),
                  {
                    label: 'Not in a Collection',
                    onClick: () => set({collection: null}),
                  },
                ]}
              />
            )}
          </Chip>
          <Chip
            label={
              filters.provider === 'any'
                ? 'Provider ▾'
                : filters.provider === 'claude'
                  ? 'Claude'
                  : 'ChatGPT'
            }
            active={filters.provider !== 'any'}
            onClick={() => setMenu('provider')}
          >
            {menu === 'provider' && (
              <Menu
                onClose={() => setMenu(null)}
                className="absolute top-full left-0 mt-1"
                items={[
                  {
                    label: 'Any Provider',
                    onClick: () => set({provider: 'any'}),
                  },
                  {
                    label: 'Used Claude',
                    onClick: () => set({provider: 'claude'}),
                  },
                  {
                    label: 'Used ChatGPT',
                    onClick: () => set({provider: 'chatgpt'}),
                  },
                ]}
              />
            )}
          </Chip>
          <Chip
            label={
              {
                any: 'Date ▾',
                today: 'Today',
                week: 'Past 7 days',
                month: 'Past 30 days',
              }[filters.date]
            }
            active={filters.date !== 'any'}
            onClick={() => setMenu('date')}
          >
            {menu === 'date' && (
              <Menu
                onClose={() => setMenu(null)}
                className="absolute top-full left-0 mt-1"
                items={[
                  {label: 'Any time', onClick: () => set({date: 'any'})},
                  {label: 'Active today', onClick: () => set({date: 'today'})},
                  {
                    label: 'Active in the past 7 days',
                    onClick: () => set({date: 'week'}),
                  },
                  {
                    label: 'Active in the past 30 days',
                    onClick: () => set({date: 'month'}),
                  },
                ]}
              />
            )}
          </Chip>
          <span className="relative ml-auto">
            <button
              onClick={() => setMenu('sort')}
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-100"
            >
              ⇅ {SORTS[sort]}
            </button>
            {menu === 'sort' && (
              <Menu
                onClose={() => setMenu(null)}
                className="absolute top-full right-0 mt-1"
                items={(Object.keys(SORTS) as Sort[]).map(s => ({
                  label: `${sort === s ? '✓ ' : '   '}${SORTS[s]}`,
                  onClick: () => setSort(s),
                }))}
              />
            )}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {!q.trim() && (
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-zinc-400">
              Recent
            </div>
          )}
          {q.trim() && !rows.length && (
            <p className="p-4 text-sm text-zinc-400">
              No Trees match “{q.trim()}”
              {JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) && (
                <>
                  {' '}
                  with these filters.{' '}
                  <button
                    onClick={() => setFilters(NO_FILTERS)}
                    className="text-zinc-700 underline"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </p>
          )}
          {rows.map((row, n) => {
            const sel = n === i
            const cls = `flex w-full cursor-default items-start gap-2.5 rounded-lg px-2.5 text-left ${sel ? 'bg-zinc-100' : ''}`
            if (row.kind === 'recent')
              return (
                <button
                  key={row.entry.key}
                  onMouseMove={() => setI(n)}
                  onClick={() => open(row)}
                  className={`${cls} items-center py-1.5 text-sm text-zinc-700`}
                >
                  <TreeIcon entry={row.entry} />
                  <span className="min-w-0 flex-1 truncate">
                    {displayTitle(row.entry)}
                  </span>
                  {row.entry.collection && (
                    <span className="text-[11px] text-zinc-400">
                      📁 {row.entry.collection}
                    </span>
                  )}
                  <span className="w-10 text-right text-[11px] text-zinc-400">
                    {relTime(row.entry.lastActive)}
                  </span>
                </button>
              )
            if (row.kind === 'hit')
              return (
                <button
                  key={`${row.r.entry.key}-${row.hit.turn.id}-${row.hit.attachment ?? ''}`}
                  onMouseMove={() => setI(n)}
                  onClick={() => open(row)}
                  className={`${cls} py-1 pl-9 text-xs text-zinc-600`}
                >
                  <HitLine hit={row.hit} />
                </button>
              )
            const r = row.r
            const b = best(r)
            const open_ = expanded.includes(r.entry.key)
            return (
              <button
                key={r.entry.key}
                onMouseMove={() => setI(n)}
                onClick={() => open(row)}
                className={`${cls} py-2`}
              >
                <span className="pt-0.5">
                  <TreeIcon entry={r.entry} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm text-zinc-800">
                    <span className="min-w-0 truncate font-medium">
                      {r.titleRanges ? (
                        <Parts
                          parts={partsOf(displayTitle(r.entry), r.titleRanges)}
                        />
                      ) : (
                        displayTitle(r.entry)
                      )}
                    </span>
                    {r.entry.collection && (
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        📁 {r.entry.collection}
                      </span>
                    )}
                    <Providers entry={r.entry} />
                    <span className="ml-auto shrink-0 text-[11px] text-zinc-400">
                      {relTime(r.entry.lastActive)}
                    </span>
                  </span>
                  {b && !open_ && (
                    <span className="mt-0.5 flex text-xs text-zinc-500">
                      <span className="line-clamp-1 min-w-0 flex-1">
                        <HitLine hit={b} />
                      </span>
                    </span>
                  )}
                  {r.hits.length > 1 && (
                    <span
                      onClick={e => {
                        e.stopPropagation()
                        toggle(r.entry.key)
                      }}
                      className="mt-0.5 inline-block text-[11px] text-zinc-400 hover:text-zinc-700"
                    >
                      {open_
                        ? '▾ Hide matches'
                        : `▸ ${r.hits.length - 1} more in this Tree`}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex gap-3 border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>→</Kbd> all matches in a Tree
          </span>
          <span>
            <Kbd>Enter</Kbd> open at that Turn
          </span>
          <span className="ml-auto">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

function HitLine({hit}: {hit: Hit}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <Who turn={hit.turn} />
      {hit.field === 'attachment' ? (
        <span>
          📎 <Parts parts={partsOf(hit.attachment!, hit.ranges)} />
        </span>
      ) : (
        <Parts
          parts={snippet(hit.turn.text, hit.ranges, 30, 120)}
          className="truncate"
        />
      )}
      {hit.turn.kind === 'reply' && (
        <span className="ml-auto pl-1">
          <ModelPill turn={hit.turn} />
        </span>
      )}
    </span>
  )
}
