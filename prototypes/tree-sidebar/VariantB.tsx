// PROTOTYPE variant B: folders, like Finder or VS Code. One level of folders you make yourself, drag Trees in, a sort
// menu, ⌘/Shift-click to select several, and full-text search in a ⌘K palette instead of the sidebar. No pins. Throw away.
import {useEffect, useMemo, useState} from 'react'

import {Menu, type MenuItem} from '../export-archive-summary/common'
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
import {displayTitle, relTime, search, type Entry} from './library'

export const name = 'Folders and ⌘K'

type Sort = 'active' | 'created' | 'name'
const SORTS: Record<Sort, string> = {
  active: 'Last active',
  created: 'Date created',
  name: 'Name',
}

export function VariantB({lib}: {lib: Lib}) {
  const [sort, setSort] = useState<Sort>('active')
  const [sortOpen, setSortOpen] = useState(false)
  const [closed, setClosed] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [palette, setPalette] = useState(false)
  const [moving, setMoving] = useState<{keys: string[]; at: DOMRect} | null>(
    null
  )
  useF2(() => setRenaming(lib.current))

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPalette(p => !p)
      }
      if (e.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const order = (list: Entry[]) =>
    [...list].sort((a, b) =>
      sort === 'name'
        ? displayTitle(a).localeCompare(displayTitle(b))
        : sort === 'created'
          ? b.created - a.created
          : b.lastActive - a.lastActive
    )
  // Visible order, for Shift-click ranges.
  const flat = [
    ...lib.folders.flatMap(f =>
      closed.includes(f) ? [] : order(lib.entries.filter(e => e.folder === f))
    ),
    ...order(lib.entries.filter(e => !e.folder)),
  ]

  const click = (e: React.MouseEvent, entry: Entry) => {
    if (e.metaKey || e.ctrlKey) {
      setSelected(s =>
        s.includes(entry.key)
          ? s.filter(k => k !== entry.key)
          : [...(s.length ? s : [lib.current]), entry.key]
      )
      setAnchor(entry.key)
      return
    }
    if (e.shiftKey && anchor) {
      const a = flat.findIndex(x => x.key === anchor)
      const b = flat.findIndex(x => x.key === entry.key)
      setSelected(
        flat.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.key)
      )
      return
    }
    setSelected([])
    setAnchor(entry.key)
    lib.pick(entry.key)
  }

  const drop = (folder: string | null) => (e: React.DragEvent) => {
    e.preventDefault()
    const key = e.dataTransfer.getData('text/tree')
    lib.moveTo(selected.includes(key) ? selected : [key], folder)
    setDropOn(null)
    setSelected([])
  }
  const dropTarget = (id: string, folder: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDropOn(id)
    },
    onDragLeave: () => setDropOn(d => (d === id ? null : d)),
    onDrop: drop(folder),
  })

  const row = (e: Entry, inFolder: boolean) => (
    <Row
      key={e.key}
      lib={lib}
      entry={e}
      inFolder={inFolder}
      sort={sort}
      selected={selected.includes(e.key)}
      renaming={renaming === e.key}
      setRenaming={setRenaming}
      onClick={ev => click(ev, e)}
      onMove={at => setMoving({keys: [e.key], at})}
    />
  )

  return (
    <Shell
      lib={lib}
      trees={
        <>
          <div className="flex items-center gap-1 px-2 pb-2">
            <button
              onClick={lib.create}
              className="flex-1 rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50"
            >
              ＋ New Tree
            </button>
            <button
              title="New folder"
              onClick={() => {
                let n = 'New folder'
                for (let i = 2; lib.folders.includes(n); i++)
                  n = `New folder ${i}`
                lib.addFolder(n)
                setRenamingFolder(n)
              }}
              className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100"
            >
              ＋📁
            </button>
            <span className="relative">
              <button
                title="Sort"
                onClick={() => setSortOpen(o => !o)}
                className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100"
              >
                ⇅
              </button>
              {sortOpen && (
                <Menu
                  onClose={() => setSortOpen(false)}
                  className="absolute top-full right-0 mt-1"
                  items={(Object.keys(SORTS) as Sort[]).map(s => ({
                    label: `${sort === s ? '✓ ' : '   '}${SORTS[s]}`,
                    onClick: () => setSort(s),
                  }))}
                />
              )}
            </span>
          </div>
          <button
            onClick={() => setPalette(true)}
            className="mx-2 mb-2 flex items-center rounded-lg bg-zinc-100 px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-200"
          >
            <span className="flex-1">🔍 Search all Trees</span>
            <kbd className="text-[10px]">⌘K</kbd>
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {lib.folders.map(f => {
              const inside = order(lib.entries.filter(e => e.folder === f))
              const isClosed = closed.includes(f)
              return (
                <div key={f} className="mb-0.5">
                  <div
                    {...dropTarget(`f:${f}`, f)}
                    onClick={() =>
                      setClosed(c =>
                        isClosed ? c.filter(x => x !== f) : [...c, f]
                      )
                    }
                    onDoubleClick={() => setRenamingFolder(f)}
                    className={`group/row flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-zinc-600 ${dropOn === `f:${f}` ? 'bg-sky-100 ring-1 ring-sky-400' : 'hover:bg-zinc-100'}`}
                  >
                    <span className="w-3 text-[10px] text-zinc-400">
                      {isClosed ? '▸' : '▾'}
                    </span>
                    <span className="text-xs">📁</span>
                    {renamingFolder === f ? (
                      <RenameInput
                        initial={f}
                        onDone={v => {
                          if (v !== null) lib.renameFolder(f, v)
                          setRenamingFolder(null)
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{f}</span>
                    )}
                    <span className="text-[11px] font-normal text-zinc-400 group-hover/row:hidden">
                      {inside.length}
                    </span>
                    <FolderMenu
                      onRename={() => setRenamingFolder(f)}
                      onDelete={() => lib.removeFolder(f)}
                    />
                  </div>
                  {!isClosed && inside.map(e => row(e, true))}
                </div>
              )
            })}
            <div
              {...dropTarget('top', null)}
              className={`mt-1 min-h-8 rounded-lg ${dropOn === 'top' ? 'bg-sky-50 ring-1 ring-sky-300' : ''}`}
            >
              {order(lib.entries.filter(e => !e.folder)).map(e =>
                row(e, false)
              )}
            </div>
          </div>
          {selected.length > 1 && (
            <div className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
              <span className="flex-1 text-zinc-600">
                {selected.length} selected
              </span>
              <button
                onClick={e =>
                  setMoving({
                    keys: selected,
                    at: e.currentTarget.getBoundingClientRect(),
                  })
                }
                className="rounded px-2 py-1 hover:bg-zinc-200"
              >
                Move to…
              </button>
              <button
                onClick={() => lib.askDelete(selected)}
                className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
              >
                Delete…
              </button>
            </div>
          )}
        </>
      }
    >
      {moving && (
        <Menu
          onClose={() => setMoving(null)}
          style={{
            position: 'fixed',
            top: Math.min(moving.at.top, window.innerHeight - 220),
            left: moving.at.right + 4,
          }}
          items={[
            ...lib.folders.map(f => ({
              label: `📁 ${f}`,
              onClick: () => {
                lib.moveTo(moving.keys, f)
                setSelected([])
              },
            })),
            'sep' as const,
            {
              label: 'Not in a folder',
              onClick: () => {
                lib.moveTo(moving.keys, null)
                setSelected([])
              },
            },
          ]}
        />
      )}
      {palette && <Palette lib={lib} onClose={() => setPalette(false)} />}
    </Shell>
  )
}

function Row({
  lib,
  entry,
  inFolder,
  sort,
  selected,
  renaming,
  setRenaming,
  onClick,
  onMove,
}: {
  lib: Lib
  entry: Entry
  inFolder: boolean
  sort: Sort
  selected: boolean
  renaming: boolean
  setRenaming: (k: string | null) => void
  onClick: (e: React.MouseEvent) => void
  onMove: (at: DOMRect) => void
}) {
  const active = entry.key === lib.current
  const extra: MenuItem[] = [
    {
      label: 'Move to folder…',
      onClick: () =>
        onMove(
          document
            .querySelector(`[data-tree="${entry.key}"]`)!
            .getBoundingClientRect()
        ),
    },
  ]
  return (
    <div
      data-tree={entry.key}
      draggable={!renaming}
      onDragStart={e => e.dataTransfer.setData('text/tree', entry.key)}
      onClick={onClick}
      onDoubleClick={() => setRenaming(entry.key)}
      className={`group/row flex cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 text-sm ${inFolder ? 'pl-7' : 'pl-2'} ${active ? 'bg-zinc-900 text-white' : selected ? 'bg-sky-100 text-zinc-900' : 'text-zinc-700 hover:bg-zinc-100'}`}
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
      <span
        className={`shrink-0 text-[11px] group-hover/row:hidden ${active ? 'text-zinc-400' : 'text-zinc-400'}`}
      >
        {relTime(sort === 'created' ? entry.created : entry.lastActive)}
      </span>
      <RowMenu
        lib={lib}
        entry={entry}
        active={active}
        pin={false}
        extra={extra}
        onRename={() => setRenaming(entry.key)}
      />
    </div>
  )
}

function FolderMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-1 text-zinc-400 hover:text-zinc-900 ${open ? 'block' : 'hidden group-hover/row:block'}`}
      >
        ⋯
      </button>
      {open && (
        <Menu
          onClose={() => setOpen(false)}
          className="absolute top-full right-0 mt-1 font-normal"
          items={[
            {label: 'Rename folder', onClick: onRename},
            {
              label: 'Delete folder',
              hint: 'keeps its Trees',
              danger: true,
              onClick: onDelete,
            },
          ]}
        />
      )}
    </span>
  )
}

// Full text across every Turn of every Tree; Enter opens the Tree on that Turn.
function Palette({lib, onClose}: {lib: Lib; onClose: () => void}) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const groups = useMemo(() => search(lib.entries, q, true), [q, lib.entries])
  const flat: {entry: Entry; turnId: string | null}[] = groups.flatMap<{
    entry: Entry
    turnId: string | null
  }>(g =>
    g.hits.length
      ? g.hits.slice(0, 3).map(h => ({entry: g.entry, turnId: h.turn.id}))
      : [{entry: g.entry, turnId: null}]
  )
  const open = (n: number) => {
    const r = flat[n]
    if (!r) return
    lib.pick(r.entry.key, r.turnId)
    onClose()
  }
  let n = -1
  return (
    <div
      className="fixed inset-0 z-[65] flex justify-center bg-black/20 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[600px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
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
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI(x => Math.min(flat.length - 1, x + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI(x => Math.max(0, x - 1))
            }
            if (e.key === 'Enter') open(i)
          }}
          placeholder="Search titles and everything said in every Tree"
          className="border-b border-zinc-200 px-4 py-3 text-sm outline-none"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {q && !groups.length && (
            <p className="p-3 text-sm text-zinc-400">Nothing found.</p>
          )}
          {!q && (
            <p className="p-3 text-xs text-zinc-400">
              Try “pizza”, “PgBouncer”, “dragon” or “mum”.
            </p>
          )}
          {groups.map(g => (
            <div key={g.entry.key} className="mb-2">
              <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-zinc-500">
                <TreeIcon entry={g.entry} />
                <span className="truncate">{displayTitle(g.entry)}</span>
                {g.entry.folder && (
                  <span className="text-zinc-400">📁 {g.entry.folder}</span>
                )}
                {g.hits.length > 3 && (
                  <span className="ml-auto text-zinc-400">
                    +{g.hits.length - 3} more
                  </span>
                )}
              </div>
              {(g.hits.length ? g.hits.slice(0, 3) : [null]).map(h => {
                n++
                const me = n
                return (
                  <button
                    key={h?.turn.id ?? 'title'}
                    onMouseEnter={() => setI(me)}
                    onClick={() => open(me)}
                    className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs text-zinc-600 ${i === me ? 'bg-zinc-100' : ''}`}
                  >
                    {h ? (
                      <>
                        <span className="mr-1.5 text-[10px] text-zinc-400 uppercase">
                          {h.turn.kind === 'prompt' ? 'You' : 'Reply'}
                        </span>
                        <Snippet parts={h.snippet} />
                      </>
                    ) : (
                      <span className="text-zinc-400">Title match</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-zinc-100 px-4 py-2 text-[11px] text-zinc-400">
          ↑↓ to move · Enter opens the Tree at that Turn · Esc closes
        </div>
      </div>
    </div>
  )
}
