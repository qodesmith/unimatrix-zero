// PROTOTYPE variant C: search first, like Mail. One field searches titles and every Turn, and its results replace the
// list, with snippets that open the Tree at that Turn. Filter chips instead of folders, two-line rows with Tree facts,
// pins, and a Select mode for deleting or archiving several. Throw away.
import {useMemo, useState} from 'react'

import {simCache} from '../canvas-mode-ux/tree'
import {useToast} from '../workspace-file-tree/common'
import {
  RenameInput,
  RowMenu,
  RowStatus,
  Shell,
  Snippet,
  Title,
  TreeIcon,
  useF2,
  type Lib,
} from './common'
import {displayTitle, relTime, search, stats, type Entry} from './library'

export const name = 'Search first'

type Filter = 'all' | 'pinned' | 'files' | 'claude' | 'chatgpt'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['pinned', '📌 Pinned'],
  ['files', '🗂 Files'],
  ['claude', 'Claude'],
  ['chatgpt', 'ChatGPT'],
]

const passes = (e: Entry, f: Filter) =>
  f === 'all'
    ? true
    : f === 'pinned'
      ? e.pinned
      : f === 'files'
        ? !!simCache.get(e.key)?.workspace
        : stats(e.key).providers.includes(f)

export function VariantC({lib}: {lib: Lib}) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  useF2(() => setRenaming(lib.current))

  const visible = lib.entries.filter(e => passes(e, filter))
  const sorted = [...visible].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActive - a.lastActive
  )
  const results = useMemo(
    () => (q.trim() ? search(visible, q, true) : null),
    [q, visible]
  )

  return (
    <Shell
      lib={lib}
      treesFill={!!results || selecting}
      trees={
        <>
          <div className="space-y-2 px-2 pb-2">
            <div className="flex gap-1">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setQ('')}
                placeholder="🔍 Search titles and Turns"
                className="min-w-0 flex-1 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-300"
              />
              <button
                onClick={lib.create}
                title="New Tree"
                className="rounded-lg bg-zinc-900 px-2.5 text-sm text-white hover:bg-zinc-700"
              >
                ＋
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${filter === f ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => {
                  setSelecting(s => !s)
                  setPicked([])
                }}
                className="ml-auto rounded-full px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-50"
              >
                {selecting ? 'Done' : 'Select'}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {results ? (
              <>
                <p className="px-2 pb-1 text-[11px] text-zinc-400">
                  {results.length
                    ? `${results.length} Tree${results.length > 1 ? 's' : ''}, ${results.reduce((n, r) => n + r.hits.length, 0)} matching Turns`
                    : 'Nothing found.'}
                </p>
                {results.map(r => (
                  <div
                    key={r.entry.key}
                    className="mb-1 rounded-lg border border-zinc-100 p-1"
                  >
                    <button
                      onClick={() => lib.pick(r.entry.key)}
                      className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm ${r.entry.key === lib.current ? 'bg-zinc-900 text-white' : 'text-zinc-800 hover:bg-zinc-100'}`}
                    >
                      <TreeIcon entry={r.entry} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {r.titleHit ? (
                          <TitleMark title={displayTitle(r.entry)} q={q} />
                        ) : (
                          displayTitle(r.entry)
                        )}
                      </span>
                      <span className="text-[11px] opacity-60">
                        {relTime(r.entry.lastActive)}
                      </span>
                    </button>
                    {r.hits.slice(0, 4).map(h => (
                      <button
                        key={h.turn.id}
                        onClick={() => lib.pick(r.entry.key, h.turn.id)}
                        className="block w-full rounded-md px-2 py-1 text-left text-[11px] leading-snug text-zinc-600 hover:bg-zinc-100"
                      >
                        <span className="mr-1 text-[9px] text-zinc-400 uppercase">
                          {h.turn.kind === 'prompt' ? 'You' : 'Reply'}
                        </span>
                        <Snippet parts={h.snippet} />
                      </button>
                    ))}
                    {r.hits.length > 4 && (
                      <p className="px-2 text-[11px] text-zinc-400">
                        +{r.hits.length - 4} more in this Tree
                      </p>
                    )}
                  </div>
                ))}
              </>
            ) : (
              sorted.map(e => (
                <Row
                  key={e.key}
                  lib={lib}
                  entry={e}
                  selecting={selecting}
                  picked={picked.includes(e.key)}
                  onPick={() =>
                    setPicked(p =>
                      p.includes(e.key)
                        ? p.filter(k => k !== e.key)
                        : [...p, e.key]
                    )
                  }
                  renaming={renaming === e.key}
                  setRenaming={setRenaming}
                />
              ))
            )}
          </div>
          {selecting && (
            <div className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
              <button
                onClick={() =>
                  setPicked(p =>
                    p.length === sorted.length ? [] : sorted.map(e => e.key)
                  )
                }
                className="text-sky-700"
              >
                {picked.length === sorted.length ? 'None' : 'All'}
              </button>
              <span className="flex-1 text-zinc-600">
                {picked.length} selected
              </span>
              <button
                disabled={!picked.length}
                onClick={() => toast('Archive of several Trees')}
                className="rounded px-2 py-1 hover:bg-zinc-200 disabled:opacity-40"
              >
                Archive…
              </button>
              <button
                disabled={!picked.length}
                onClick={() => {
                  lib.askDelete(picked)
                  setPicked([])
                }}
                className="rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                Delete…
              </button>
            </div>
          )}
        </>
      }
    />
  )
}

function TitleMark({title, q}: {title: string; q: string}) {
  const at = title.toLowerCase().indexOf(q.trim().toLowerCase())
  if (at < 0) return <>{title}</>
  const n = q.trim().length
  return (
    <Snippet
      parts={[title.slice(0, at), title.slice(at, at + n), title.slice(at + n)]}
    />
  )
}

function Row({
  lib,
  entry,
  selecting,
  picked,
  onPick,
  renaming,
  setRenaming,
}: {
  lib: Lib
  entry: Entry
  selecting: boolean
  picked: boolean
  onPick: () => void
  renaming: boolean
  setRenaming: (k: string | null) => void
}) {
  const active = entry.key === lib.current
  const st = stats(entry.key)
  return (
    <div
      data-tree={entry.key}
      onClick={() => (selecting ? onPick() : lib.pick(entry.key))}
      onDoubleClick={() => !selecting && setRenaming(entry.key)}
      className={`group/row flex cursor-default items-start gap-2 rounded-lg px-2 py-1.5 ${active && !selecting ? 'bg-zinc-900 text-white' : picked ? 'bg-sky-100' : 'text-zinc-700 hover:bg-zinc-100'}`}
    >
      {selecting ? (
        <input
          type="checkbox"
          readOnly
          checked={picked}
          className="mt-1 shrink-0"
        />
      ) : (
        <span className="mt-0.5">
          <TreeIcon entry={entry} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {entry.pinned && <span className="text-[10px]">📌</span>}
          {renaming ? (
            <RenameInput
              initial={displayTitle(entry)}
              onDone={v => {
                if (v !== null) lib.rename(entry.key, v)
                setRenaming(null)
              }}
            />
          ) : (
            <Title lib={lib} entry={entry} />
          )}
          <RowStatus entry={entry} />
        </div>
        <div
          className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${active && !selecting ? 'text-zinc-400' : 'text-zinc-400'}`}
        >
          <span>{relTime(entry.lastActive)}</span>
          <span>·</span>
          <span>{st.turns} Turns</span>
          {st.forks > 0 && (
            <>
              <span>·</span>
              <span>
                {st.forks} Fork{st.forks > 1 ? 's' : ''}
              </span>
            </>
          )}
          <span className="ml-auto flex gap-0.5">
            {st.providers.map(p => (
              <span
                key={p}
                title={p === 'claude' ? 'Claude' : 'ChatGPT'}
                className={`rounded px-1 text-[9px] font-semibold ${p === 'claude' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}
              >
                {p === 'claude' ? 'C' : 'G'}
              </span>
            ))}
          </span>
        </div>
      </div>
      {!selecting && (
        <RowMenu
          lib={lib}
          entry={entry}
          active={active}
          onRename={() => setRenaming(entry.key)}
        />
      )}
    </div>
  )
}
