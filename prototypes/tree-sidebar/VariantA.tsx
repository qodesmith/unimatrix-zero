// PROTOTYPE variant A: a recent list, like Claude.ai and ChatGPT. Pinned on top, then date groups by last activity, a
// filter that matches titles only, AI titles, double-click to rename, ⋯ for everything else. No folders. Throw away.
import {useState} from 'react'

import {
  RenameInput,
  RowMenu,
  RowStatus,
  Shell,
  Title,
  TreeIcon,
  useF2,
  type Lib,
} from './common'
import {dateGroup, displayTitle, search, type Entry} from './library'

export const name = 'Recent list'

export function VariantA({lib}: {lib: Lib}) {
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  useF2(() => setRenaming(lib.current))

  const sorted = [...lib.entries].sort((a, b) => b.lastActive - a.lastActive)
  const groups: [string, Entry[]][] = []
  const pinned = sorted.filter(e => e.pinned)
  if (pinned.length) groups.push(['Pinned', pinned])
  for (const e of sorted.filter(e => !e.pinned)) {
    const g = dateGroup(e.lastActive)
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(e)
    else groups.push([g, [e]])
  }
  const found = q ? search(lib.entries, q, false).map(h => h.entry) : null

  const row = (e: Entry) => (
    <Row
      key={e.key}
      lib={lib}
      entry={e}
      renaming={renaming === e.key}
      setRenaming={setRenaming}
    />
  )

  return (
    <Shell
      lib={lib}
      trees={
        <>
          <div className="space-y-1.5 px-2 pb-2">
            <button
              onClick={lib.create}
              className="w-full rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50"
            >
              ＋ New Tree
            </button>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setQ('')}
              placeholder="Filter by title"
              className="w-full rounded-lg bg-zinc-100 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-zinc-300"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {found ? (
              <>
                {found.map(row)}
                <p className="px-2 pt-2 text-[11px] text-zinc-400">
                  {found.length ? '' : 'No titles match. '}Matches titles only.
                </p>
              </>
            ) : (
              groups.map(([g, list]) => (
                <div key={g} className="mb-2">
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-zinc-400">
                    {g === 'Pinned' ? '📌 Pinned' : g}
                  </div>
                  {list.map(row)}
                </div>
              ))
            )}
          </div>
        </>
      }
    />
  )
}

function Row({
  lib,
  entry,
  renaming,
  setRenaming,
}: {
  lib: Lib
  entry: Entry
  renaming: boolean
  setRenaming: (k: string | null) => void
}) {
  const active = entry.key === lib.current
  return (
    <div
      data-tree={entry.key}
      onClick={() => lib.pick(entry.key)}
      onDoubleClick={() => setRenaming(entry.key)}
      className={`group/row flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
    >
      <TreeIcon entry={entry} />
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
      <RowMenu
        lib={lib}
        entry={entry}
        active={active}
        onRename={() => setRenaming(entry.key)}
      />
    </div>
  )
}
