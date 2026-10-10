// PROTOTYPE: shared pieces for the Tree sidebar variants: library state, the app around the sidebar, row menu, inline
// rename, delete confirmation. Throw away.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {createPortal} from 'react-dom'

import {
  DecorContext,
  useSim,
  type Decor,
  type HostApi,
} from '../canvas-mode-ux/shared'
import {simCache} from '../canvas-mode-ux/tree'
import {VariantD} from '../canvas-mode-ux/VariantD'
import {Btn, Menu, Modal, type MenuItem} from '../export-archive-summary/common'
import {
  FileChips,
  FilePreview,
  UserEdits,
  useToast,
} from '../workspace-file-tree/common'
import {FilesPanel} from '../workspace-file-tree/VariantA'
import {formatSize} from '../workspace-file-tree/workspace'
import {
  displayTitle,
  fakeAiTitle,
  firstReplyDone,
  freesBytes,
  INITIAL,
  INITIAL_FOLDERS,
  newEntry,
  rootPrompt,
  stats,
  type Entry,
} from './library'

export const SIDEBAR = 290
const MIN_SIDEBAR = SIDEBAR
const MAX_SIDEBAR = 640

// Sidebar layout outlives the Shell, which remounts on every Tree switch.
const layout = {width: SIDEBAR, split: 0.55, filesOpen: true}
function useLayout<K extends keyof typeof layout>(k: K) {
  const [v, setV] = useState(layout[k])
  return [
    v,
    (next: (typeof layout)[K]) => {
      layout[k] = next
      setV(next)
    },
  ] as const
}

// ---------- library state, shared by every variant ----------

export type Lib = ReturnType<typeof useLibrary>

export function useLibrary() {
  const [entries, setEntries] = useState<Entry[]>(INITIAL)
  const [folders, setFolders] = useState<string[]>(INITIAL_FOLDERS)
  const [current, setCurrent] = useState(INITIAL[0]!.key)
  // A Turn to open in the slideout once the picked Tree has mounted (search results).
  const [pendingTurn, setPendingTurn] = useState<string | null>(null)
  const [justTitled, setJustTitled] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const version = useSyncExternalStore(simCache.subscribe, simCache.version)
  const sizes = useRef<Record<string, number>>({})

  const patch = (key: string, p: Partial<Entry>) =>
    setEntries(list => list.map(e => (e.key === key ? {...e, ...p} : e)))

  // Activity bumps lastActive; the first finished Reply brings the AI title.
  useEffect(() => {
    for (const e of entries) {
      const tree = simCache.get(e.key)?.tree ?? {}
      const n = Object.keys(tree).length
      if (sizes.current[e.key] !== undefined && sizes.current[e.key] !== n)
        patch(e.key, {lastActive: Date.now()})
      sizes.current[e.key] = n
      if (e.titleSource === 'prompt' && firstReplyDone(tree)) {
        const title = fakeAiTitle(rootPrompt(tree)!.text)
        setTimeout(() => {
          setEntries(list =>
            list.map(x =>
              x.key === e.key && x.titleSource === 'prompt'
                ? {...x, title, titleSource: 'ai'}
                : x
            )
          )
          setJustTitled(e.key)
          setTimeout(() => setJustTitled(null), 1600)
        }, 700)
      }
    }
  }, [version, entries])

  return {
    entries,
    folders,
    current,
    pendingTurn,
    justTitled,
    deleting,
    pick: (key: string, turnId: string | null = null) => {
      setCurrent(key)
      setPendingTurn(turnId)
    },
    clearPending: () => setPendingTurn(null),
    create: () => {
      const e = newEntry()
      simCache.set(e.key, e.init())
      setEntries(list => [e, ...list])
      setCurrent(e.key)
      return e
    },
    rename: (key: string, title: string) => {
      const t = title.trim()
      if (t) patch(key, {title: t, titleSource: 'user'})
    },
    togglePin: (key: string) =>
      setEntries(list =>
        list.map(e => (e.key === key ? {...e, pinned: !e.pinned} : e))
      ),
    moveTo: (keys: string[], folder: string | null) =>
      setEntries(list =>
        list.map(e => (keys.includes(e.key) ? {...e, folder} : e))
      ),
    addFolder: (name: string) => {
      const n = name.trim()
      if (n && !folders.includes(n)) setFolders(f => [...f, n])
      return n
    },
    renameFolder: (from: string, to: string) => {
      const n = to.trim()
      if (!n || folders.includes(n)) return
      setFolders(f => f.map(x => (x === from ? n : x)))
      setEntries(list =>
        list.map(e => (e.folder === from ? {...e, folder: n} : e))
      )
    },
    // Deleting a folder never deletes its Trees; they go back to the top level.
    removeFolder: (name: string) => {
      setFolders(f => f.filter(x => x !== name))
      setEntries(list =>
        list.map(e => (e.folder === name ? {...e, folder: null} : e))
      )
    },
    askDelete: (keys: string[]) => setDeleting(keys),
    cancelDelete: () => setDeleting(null),
    confirmDelete: () => {
      const gone = deleting ?? []
      const rest = entries.filter(e => !gone.includes(e.key))
      setDeleting(null)
      if (gone.includes(current)) {
        if (rest.length) {
          const next = [...rest].sort((a, b) => b.lastActive - a.lastActive)[0]!
          setCurrent(next.key)
        } else {
          const e = newEntry()
          simCache.set(e.key, e.init())
          rest.push(e)
          setCurrent(e.key)
        }
      }
      setEntries(rest)
    },
  }
}

// ---------- the app around the sidebar ----------

export function Shell({
  lib,
  trees,
  treesFill,
  children,
}: {
  lib: Lib
  trees: ReactNode
  // The Tree list takes the whole sidebar (search results, select mode).
  treesFill?: boolean
  children?: ReactNode
}) {
  const sim = useSim()
  const host = useRef<HostApi | null>(null)
  const [drawerReply, setDrawerReply] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    path: string
    turnId: string | null
  } | null>(null)
  const focus = drawerReply ?? sim.activeReplyId
  const [width, setWidth] = useLayout('width')
  const [resizing, setResizing] = useState(false)
  // Pointer moves land several times a frame; apply only the latest, once per frame.
  const nextWidth = useRef<number | null>(null)
  const resizeTo = (x: number) => {
    const pending = nextWidth.current !== null
    nextWidth.current = Math.round(
      Math.min(Math.max(x, MIN_SIDEBAR), MAX_SIDEBAR)
    )
    if (pending) return
    requestAnimationFrame(() => {
      setWidth(nextWidth.current!)
      nextWidth.current = null
    })
  }

  useEffect(() => {
    if (!lib.pendingTurn) return
    const id = lib.pendingTurn
    const t = setTimeout(() => {
      host.current?.select(id)
      lib.clearPending()
    }, 350)
    return () => clearTimeout(t)
  }, [lib.pendingTurn])

  const decor = useMemo<Decor>(
    () => ({
      hostApi: host,
      leftInset: width,
      replyBottom: (r, where) =>
        where === 'canvas' ? (
          <FileChips
            reply={r}
            onOpen={path => setPreview({path, turnId: r.id})}
          />
        ) : null,
      prompt: p => <UserEdits prompt={p} />,
      onFocusReply: id => setDrawerReply(id),
    }),
    [width]
  )

  return (
    <DecorContext.Provider value={decor}>
      <div className="flex h-full">
        <aside
          style={{width}}
          className="relative flex shrink-0 flex-col border-r border-zinc-200 bg-white"
        >
          <div
            title="Drag to resize · double-click to reset"
            onPointerDown={e => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              setResizing(true)
            }}
            onPointerMove={e => resizing && resizeTo(e.clientX)}
            onPointerUp={() => setResizing(false)}
            onPointerCancel={() => setResizing(false)}
            onDoubleClick={() => setWidth(SIDEBAR)}
            className="group absolute inset-y-0 -right-[5px] z-20 w-[9px] cursor-col-resize"
          >
            <div
              className={`mx-auto h-full w-[3px] ${resizing ? 'bg-sky-500' : 'group-hover:bg-sky-500'}`}
            />
          </div>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <span className="flex-1 truncate text-sm font-semibold text-zinc-900">
              Unimatrix Zero
            </span>
            {width !== SIDEBAR && (
              <button
                title="Reset sidebar width"
                onClick={() => setWidth(SIDEBAR)}
                className="text-xs text-zinc-400 hover:text-zinc-900"
              >
                ⇤⇥
              </button>
            )}
            <button
              title="Settings"
              className="text-zinc-400 hover:text-zinc-900"
            >
              ⚙
            </button>
          </div>
          {treesFill ? (
            <div className="flex min-h-0 flex-1 flex-col">{trees}</div>
          ) : (
            <SplitSections
              trees={trees}
              filesHeader={
                // Says only where the files live; kept in the app is the default, so it's unlabelled.
                sim.workspace?.kind === 'linked' && (
                  <LinkedFolderBadge path={sim.workspace.path} />
                )
              }
              files={
                <FilesPanel
                  titleRow={false}
                  focus={focus}
                  following={!drawerReply}
                  onBackToLatest={() => host.current?.select(null)}
                  onOpen={path => setPreview({path, turnId: null})}
                  selected={preview?.turnId === null ? preview.path : null}
                  onAdd={() => {}}
                />
              }
            />
          )}
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <VariantD />
            {preview && sim.tree[preview.turnId ?? focus] && (
              <div className="absolute top-0 bottom-0 left-0 z-30 flex w-[460px] flex-col border-r border-zinc-200 shadow-xl">
                <FilePreview
                  path={preview.path}
                  turnId={preview.turnId ?? focus}
                  onClose={() => setPreview(null)}
                  className="flex-1"
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {lib.deleting && <DeleteDialog lib={lib} keys={lib.deleting} />}
      {children}
    </DecorContext.Provider>
  )
}

// The full path shows on hover only when it's cut off. A drawn tooltip, not `title`, so it always appears.
function LinkedFolderBadge({path}: {path: string}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const [tip, setTip] = useState<DOMRect | null>(null)
  useEffect(() => {
    const el = ref.current!
    const check = () => setCut(el.scrollWidth > el.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [path])
  return (
    <>
      <span
        ref={ref}
        onMouseEnter={e =>
          cut && setTip(e.currentTarget.getBoundingClientRect())
        }
        onMouseLeave={() => setTip(null)}
        className="max-w-[60%] min-w-0 truncate rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
      >
        🔗 {path}
      </span>
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{position: 'fixed', top: tip.bottom + 6, left: tip.left}}
            className="pointer-events-none z-[80] max-w-[420px] rounded-md bg-zinc-900 px-2 py-1 text-[11px] text-white shadow-lg"
          >
            {path.split('/').map((part, i) => (
              <span key={i}>
                {i > 0 && '/'}
                {i > 0 && <wbr />}
                <span className="whitespace-nowrap">{part}</span>
              </span>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

// ---------- Trees above Files, split like VS Code's Explorer ----------

const MIN_TREES = 120
// The Files header, the status box and a few rows.
const MIN_FILES = 180

function SplitSections({
  trees,
  files,
  filesHeader,
}: {
  trees: ReactNode
  files: ReactNode
  filesHeader: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  // The Trees section's share of the sidebar body, so it survives window resizes.
  const [split, setSplit] = useLayout('split')
  const [open, setOpen] = useLayout('filesOpen')
  const [dragging, setDragging] = useState(false)

  const drag = (clientY: number) => {
    const r = body.current!.getBoundingClientRect()
    const y = Math.min(
      Math.max(clientY - r.top, MIN_TREES),
      r.height - MIN_FILES
    )
    setSplit(y / r.height)
  }

  return (
    <div ref={body} className="flex min-h-0 flex-1 flex-col">
      <div
        style={
          open ? {height: `${split * 100}%`, minHeight: MIN_TREES} : undefined
        }
        className={`flex min-h-0 flex-col ${open ? '' : 'flex-1'}`}
      >
        {trees}
      </div>
      <div className="relative h-px shrink-0 bg-zinc-200">
        {open && (
          <div
            onPointerDown={e => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragging(true)
            }}
            onPointerMove={e => dragging && drag(e.clientY)}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            className="group absolute inset-x-0 -top-1 z-10 h-[9px] cursor-row-resize"
          >
            <div
              className={`mt-[3px] h-[3px] ${dragging ? 'bg-sky-500' : 'group-hover:bg-sky-500'}`}
            />
          </div>
        )}
      </div>
      <div
        style={open ? {minHeight: MIN_FILES} : undefined}
        className={`flex flex-col ${open ? 'min-h-0 flex-1' : 'shrink-0'}`}
      >
        <div className="flex items-center justify-between gap-2 pr-3">
          <button
            onClick={() => setOpen(!open)}
            className="flex shrink-0 grow items-center gap-1 py-1.5 pl-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-900"
          >
            <span className="w-3 text-center">{open ? '▾' : '▸'}</span>
            Files
          </button>
          {open && filesHeader}
        </div>
        {open && <div className="flex min-h-0 flex-1 flex-col">{files}</div>}
      </div>
    </div>
  )
}

// ---------- row pieces ----------

export function TreeIcon({entry}: {entry: Entry}) {
  const s = simCache.get(entry.key)
  return (
    <span className="w-4 shrink-0 text-center text-xs">
      {!s?.workspace ? '💬' : s.workspace.kind === 'app' ? '🗂' : '🔗'}
    </span>
  )
}

// Streaming somewhere in the Tree, or a failure the user hasn't seen.
export function RowStatus({entry}: {entry: Entry}) {
  const st = stats(entry.key)
  if (st.streaming)
    return (
      <span
        title="A Reply is streaming"
        className="size-2 shrink-0 animate-pulse rounded-full bg-sky-500"
      />
    )
  if (st.failed)
    return (
      <span
        title="A Reply failed"
        className="size-2 shrink-0 rounded-full bg-red-500"
      />
    )
  return null
}

export function Title({
  lib,
  entry,
  className = '',
}: {
  lib: Lib
  entry: Entry
  className?: string
}) {
  const fresh = lib.justTitled === entry.key
  return (
    <span
      className={`min-w-0 flex-1 truncate ${entry.titleSource === 'prompt' ? 'italic opacity-70' : ''} ${fresh ? 'animate-pulse text-violet-600' : ''} ${className}`}
      title={
        entry.titleSource === 'prompt'
          ? 'Using the first Prompt until the AI writes a title'
          : entry.titleSource === 'ai'
            ? 'Title written by the AI'
            : 'Renamed by you'
      }
    >
      {fresh && '✦ '}
      {displayTitle(entry)}
    </span>
  )
}

export function RenameInput({
  initial,
  onDone,
  className = '',
}: {
  initial: string
  onDone: (value: string | null) => void
  className?: string
}) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      autoFocus
      value={v}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={e => {
        if (e.key === 'Enter') finish(v)
        if (e.key === 'Escape') finish(null)
      }}
      onClick={e => e.stopPropagation()}
      className={`min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 text-sm text-zinc-900 outline-none ${className}`}
    />
  )
}

// The ⋯ menu decided in Export, Archive and Summary entry points, with Rename, Pin and Delete live.
export function RowMenu({
  lib,
  entry,
  active,
  onRename,
  extra = [],
  pin = true,
}: {
  lib: Lib
  entry: Entry
  active: boolean
  onRename: () => void
  extra?: MenuItem[]
  pin?: boolean
}) {
  const toast = useToast()
  const [open, setOpen] = useState<DOMRect | null>(null)
  const elsewhere = () => toast('Decided in Export, Archive and Summary')
  const items: MenuItem[] = [
    {label: 'Rename', hint: 'F2', onClick: onRename},
    ...(pin
      ? [
          {
            label: entry.pinned ? 'Unpin' : 'Pin to top',
            onClick: () => lib.togglePin(entry.key),
          },
        ]
      : []),
    ...extra,
    {label: 'Storage…', onClick: elsewhere},
    'sep',
    {label: 'Summarize this Tree…', onClick: elsewhere},
    {label: 'Export Tree…', hint: 'Markdown', onClick: elsewhere},
    {label: 'Archive…', onClick: elsewhere},
    'sep',
    {label: 'Delete…', danger: true, onClick: () => lib.askDelete([entry.key])},
  ]
  return (
    <>
      <button
        onClick={e => {
          e.stopPropagation()
          const r = (
            e.currentTarget.closest('[data-tree]') ?? e.currentTarget
          ).getBoundingClientRect()
          setOpen(o => (o ? null : r))
        }}
        className={`shrink-0 px-1 ${open ? 'block' : 'hidden group-hover/row:block'} ${active ? 'text-zinc-300 hover:text-white' : 'text-zinc-400 hover:text-zinc-900'}`}
        title="More"
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <Menu
            items={items}
            onClose={() => setOpen(null)}
            style={{
              position: 'fixed',
              top: Math.min(open.bottom + 4, window.innerHeight - 330),
              left: open.right - 208,
            }}
            className="text-zinc-800"
          />,
          document.body
        )}
    </>
  )
}

// ---------- delete ----------

function DeleteDialog({lib, keys}: {lib: Lib; keys: string[]}) {
  const toast = useToast()
  const picked = lib.entries.filter(e => keys.includes(e.key))
  const turns = picked.reduce((n, e) => n + stats(e.key).turns, 0)
  const bytes = picked.reduce((n, e) => n + freesBytes(e.key), 0)
  const linked = picked.filter(
    e => simCache.get(e.key)?.workspace?.kind === 'linked'
  )
  const withFiles = picked.filter(e => simCache.get(e.key)?.workspace)
  const one = picked.length === 1
  return (
    <Modal onClose={lib.cancelDelete} width={440}>
      <h2 className="mb-2 text-base font-semibold text-zinc-900">
        {one
          ? `Delete “${displayTitle(picked[0]!)}”?`
          : `Delete ${picked.length} Trees?`}
      </h2>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-zinc-700">
        <li>
          {turns} Turns{one ? '' : ` across ${picked.length} Trees`} are deleted
          for good.
        </li>
        {withFiles.length > 0 && (
          <li>
            Every saved version of {one ? 'its' : 'their'} Workspace files is
            deleted.
          </li>
        )}
        {linked.length > 0 && (
          <li>
            Your linked folder{linked.length > 1 ? 's stay' : ' stays'} where{' '}
            {linked.length > 1 ? 'they are' : 'it is'}, untouched.
          </li>
        )}
        <li>
          Deleting frees up to <b>{formatSize(bytes)}</b>.
        </li>
      </ul>
      <p className="mb-4 text-xs text-zinc-500">
        This can't be undone. To keep a copy, Archive {one ? 'it' : 'them'}{' '}
        first.
      </p>
      <div className="flex justify-end gap-2">
        <Btn onClick={lib.cancelDelete}>Cancel</Btn>
        <Btn onClick={() => toast('Decided in Export, Archive and Summary')}>
          Archive first…
        </Btn>
        <Btn danger onClick={lib.confirmDelete}>
          Delete{one ? '' : ` ${picked.length} Trees`}
        </Btn>
      </div>
    </Modal>
  )
}

// ---------- search snippets ----------

export function Snippet({parts}: {parts: [string, string, string]}) {
  return (
    <span>
      {parts[0]}
      <mark className="rounded bg-amber-200 px-0.5 text-zinc-900">
        {parts[1]}
      </mark>
      {parts[2]}
    </span>
  )
}

// F2 renames the current Tree in every variant.
export function useF2(onF2: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (
        e.key === 'F2' &&
        !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        onF2()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onF2])
}
