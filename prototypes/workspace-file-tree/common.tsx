// PROTOTYPE: pieces the Workspace file tree variants share (file tree, preview, Tree list, dialogs). Throw away.
import type {GitStatusEntry} from '@pierre/trees'

import {FileTree, useFileTree, useFileTreeSelection} from '@pierre/trees/react'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import {useSim} from '../canvas-mode-ux/shared'
import {
  simCache,
  type FileChange,
  type Tree,
  type Workspace,
} from '../canvas-mode-ux/tree'
import {
  baseName,
  contentBefore,
  countOps,
  fileKind,
  isLeaf,
  OP_STYLE,
  PICKED_FOLDER,
  snapshotAt,
  type TreeEntry,
} from './workspace'

// ---------- file tree (@pierre/trees) ----------

// Remounts when the paths or colours change; @pierre/trees owns expansion and selection inside.
export function FilesTree({
  paths,
  status,
  selected,
  onSelect,
  decorate,
}: {
  paths: string[]
  status: GitStatusEntry[]
  selected: string | null
  onSelect: (path: string) => void
  decorate?: (path: string) => string | null
}) {
  const sig = `${paths.join('|')}#${status.map(s => s.path + s.status).join('|')}`
  return (
    <FilesTreeInner
      key={sig}
      paths={paths}
      status={status}
      selected={selected}
      onSelect={onSelect}
      decorate={decorate}
    />
  )
}

function FilesTreeInner({
  paths,
  status,
  selected,
  onSelect,
  decorate,
}: Parameters<typeof FilesTree>[0]) {
  const decorateRef = useRef(decorate)
  decorateRef.current = decorate
  const {model} = useFileTree({
    paths,
    gitStatus: status,
    initialExpansion: 'open',
    density: 'compact',
    initialSelectedPaths: selected ? [selected] : [],
    renderRowDecoration: ({item}) => {
      const text = decorateRef.current?.(item.path)
      return text ? {text} : null
    },
  })
  const sel = useFileTreeSelection(model)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  // Keyed on the path, not the array: useFileTreeSelection returns a new array every render.
  const picked = sel[0]
  useEffect(() => {
    if (picked && picked !== selected) onSelectRef.current(picked)
  }, [picked])
  return (
    <FileTree model={model} style={{height: '100%', colorScheme: 'light'}} />
  )
}

export const gitStatusFor = (changes: FileChange[] = []): GitStatusEntry[] =>
  changes.map(c => ({path: c.path, status: c.op}))

// ---------- preview ----------

function Markdown({text}: {text: string}) {
  return (
    <div className="space-y-1 text-sm leading-relaxed text-zinc-800">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('# '))
          return (
            <h1 key={i} className="pt-1 text-lg font-semibold">
              {line.slice(2)}
            </h1>
          )
        if (line.startsWith('## '))
          return (
            <h2 key={i} className="pt-2 font-semibold">
              {line.slice(3)}
            </h2>
          )
        if (/^(- |\d+\. )/.test(line))
          return (
            <div key={i} className="pl-4 -indent-3">
              • {line.replace(/^(- |\d+\. )/, '').replace(/\*\*/g, '')}
            </div>
          )
        if (line.startsWith('|')) {
          const cells = line.split('|').filter(Boolean)
          return (
            <div
              key={i}
              className="grid font-mono text-xs"
              style={{gridTemplateColumns: `repeat(${cells.length}, 1fr)`}}
            >
              {cells.map((c, j) => (
                <span key={j} className="border border-zinc-200 px-1">
                  {c.trim()}
                </span>
              ))}
            </div>
          )
        }
        return line ? <p key={i}>{line}</p> : <div key={i} className="h-1" />
      })}
    </div>
  )
}

function Csv({text}: {text: string}) {
  const rows = text
    .trim()
    .split('\n')
    .map(r => r.split(','))
  return (
    <table className="w-full border-collapse text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={i === 0 ? 'bg-zinc-100 font-medium' : ''}>
            {r.map((c, j) => (
              <td key={j} className="border border-zinc-200 px-2 py-1">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function FileBody({path, content}: {path: string; content: string}) {
  const kind = fileKind(path)
  if (kind === 'md') return <Markdown text={content} />
  if (kind === 'csv') return <Csv text={content} />
  if (kind === 'image')
    return (
      <img
        src={
          content.startsWith('data:')
            ? content
            : `data:image/svg+xml,${encodeURIComponent(content)}`
        }
        alt={path}
        className="max-h-[50vh] rounded-lg border border-zinc-200 bg-white"
      />
    )
  if (kind === 'pdf')
    return (
      <p className="text-sm text-zinc-500">
        No preview for PDFs yet. Open it in your default app.
      </p>
    )
  return (
    <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800">
      {content}
    </pre>
  )
}

// A file at a Turn: live files (a Thread's leaf) can be opened and revealed; earlier versions only as a read-only copy.
export function FilePreview({
  path,
  turnId,
  onClose,
  className = '',
  compact,
}: {
  path: string
  turnId: string
  onClose?: () => void
  className?: string
  compact?: boolean
}) {
  const sim = useSim()
  const toast = useToast()
  const file = snapshotAt(
    sim.tree,
    turnId,
    sim.workspace,
    sim.pendingEdits[turnId]
  ).get(path)
  const change = sim.tree[turnId]?.files?.find(f => f.path === path)
  const deleted = change?.op === 'deleted'
  const content =
    file?.content ??
    (deleted ? contentBefore(sim.tree, turnId, path, sim.workspace) : undefined)
  const live = isLeaf(sim.tree, turnId)
  const where =
    sim.workspace?.kind === 'linked'
      ? sim.workspace.path
      : 'the app’s Workspace folder'
  const changedBy = file?.changedBy ? sim.tree[file.changedBy] : undefined
  const pendingEdit = file?.changedBy === 'you'
  return (
    <div className={`flex min-h-0 flex-col bg-white ${className}`}>
      <div className="flex items-start gap-2 border-b border-zinc-200 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-900">
            {baseName(path)}
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {path}
            {change ? (
              <span className={`ml-2 ${OP_STYLE[change.op].text}`}>
                · {OP_STYLE[change.op].verb} in this{' '}
                {sim.tree[turnId]?.kind === 'prompt'
                  ? 'Prompt (by you)'
                  : 'Reply'}
              </span>
            ) : pendingEdit ? (
              <span className="ml-2 text-sky-700">
                · edited by you since this Reply (the AI sees it with your next
                Prompt)
              </span>
            ) : changedBy ? (
              <span className="ml-2">
                · last changed{' '}
                {changedBy.kind === 'prompt' ? 'by you' : 'by the AI'} earlier
                in this Thread
              </span>
            ) : (
              file && <span className="ml-2">· already in the folder</span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="text-zinc-400 hover:text-zinc-900"
          >
            ✕
          </button>
        )}
      </div>
      {!live && !deleted && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-900">
          How this file looked at this Turn. Later Turns in this Thread may have
          changed it.
        </div>
      )}
      <div
        className={`min-h-0 flex-1 overflow-auto p-4 ${deleted ? 'opacity-50' : ''}`}
      >
        {content === undefined ? (
          <p className="text-sm text-zinc-500">
            Not in the Workspace at this Turn.
          </p>
        ) : (
          <FileBody path={path} content={content} />
        )}
      </div>
      {!deleted && content !== undefined && (
        <div
          className={`flex flex-wrap items-center gap-2 border-t border-zinc-200 px-4 py-2 ${compact ? 'text-[11px]' : 'text-xs'}`}
        >
          {live ? (
            <>
              <ActionButton
                onClick={() =>
                  toast(`Opens ${baseName(path)} in its default app`)
                }
              >
                Open in default app
              </ActionButton>
              <ActionButton
                onClick={() =>
                  toast(`Shows ${baseName(path)} in Finder, inside ${where}`)
                }
              >
                Reveal in Finder
              </ActionButton>
            </>
          ) : (
            <>
              <ActionButton
                onClick={() =>
                  toast(
                    `Opens a read-only copy of this version of ${baseName(path)}`
                  )
                }
              >
                Open this version
              </ActionButton>
              <ActionButton
                onClick={() =>
                  toast(`Save dialog for this version of ${baseName(path)}`)
                }
              >
                Save a copy…
              </ActionButton>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const ActionButton = ({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) => (
  <button
    onClick={onClick}
    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-700 hover:bg-zinc-100"
  >
    {children}
  </button>
)

// ---------- small bits ----------

export function OpCounts({
  files,
  className = '',
}: {
  files?: FileChange[]
  className?: string
}) {
  const c = countOps(files)
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${className}`}>
      {c.added > 0 && <span className={OP_STYLE.added.text}>+{c.added}</span>}
      {c.modified > 0 && (
        <span className={OP_STYLE.modified.text}>~{c.modified}</span>
      )}
      {c.deleted > 0 && (
        <span className={OP_STYLE.deleted.text}>−{c.deleted}</span>
      )}
    </span>
  )
}

export const Spinner = () => (
  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-300 border-t-violet-700" />
)

export function WorkspaceChip({
  workspace,
  shell,
}: {
  workspace: Workspace | null
  shell: boolean
}) {
  if (!workspace)
    return (
      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
        Plain chat
      </span>
    )
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
      title={
        shell
          ? 'The AI can write files and run commands'
          : 'The AI can write files'
      }
    >
      {workspace.kind === 'app' ? 'Files in the app' : `🔗 ${workspace.path}`}
      {shell && <span className="rounded bg-violet-200 px-1">shell</span>}
    </span>
  )
}

// User edits recorded on a Prompt: changes made in the folder between Turns.
export function UserEdits({prompt}: {prompt: {files?: FileChange[]}}) {
  if (!prompt.files?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-sky-800">
      <span>✎ You edited</span>
      {prompt.files.map(f => (
        <span key={f.path} className="rounded bg-white/70 px-1 font-mono">
          {baseName(f.path)}
        </span>
      ))}
    </div>
  )
}

// ---------- toast ----------

const ToastContext = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({children}: {children: ReactNode}) {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = (m: string) => {
    clearTimeout(timer.current)
    setMsg(m)
    timer.current = setTimeout(() => setMsg(null), 2600)
  }
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="fixed bottom-16 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg">
          {msg} <span className="text-zinc-400">(prototype)</span>
        </div>
      )}
    </ToastContext.Provider>
  )
}

// ---------- Tree list ----------

const useCacheVersion = () =>
  useSyncExternalStore(simCache.subscribe, simCache.version)

export function TreeList({
  entries,
  current,
  onPick,
  onNew,
  compact,
}: {
  entries: TreeEntry[]
  current: string
  onPick: (key: string) => void
  onNew: () => void
  compact?: boolean
}) {
  useCacheVersion()
  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={onNew}
        className="mb-1 rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50"
      >
        ＋ New Tree
      </button>
      {entries.map(e => {
        const s = simCache.get(e.key)
        const root = s && Object.values(s.tree).find(t => !t.parentId)
        const title =
          e.title === 'New Tree'
            ? root?.text.split('\n')[0] || e.title
            : e.title
        const icon = !s?.workspace
          ? '💬'
          : s.workspace.kind === 'app'
            ? '🗂'
            : '🔗'
        return (
          <button
            key={e.key}
            onClick={() => onPick(e.key)}
            title={
              s?.workspace
                ? s.workspace.kind === 'app'
                  ? 'Has a Workspace'
                  : `Linked to ${s.workspace.path}`
                : 'Plain chat'
            }
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${e.key === current ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            <span className="text-xs">{icon}</span>
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {!compact && s?.workspace && (
              <span
                className={`text-[10px] ${e.key === current ? 'text-zinc-300' : 'text-zinc-400'}`}
              >
                {fileCount(s.tree, s.activeReplyId, s.workspace)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const fileCount = (tree: Tree, replyId: string, ws: Workspace) => {
  const n = snapshotAt(tree, replyId, ws).size
  return `${n} file${n === 1 ? '' : 's'}`
}

// ---------- adding a Workspace to a plain Tree ----------

export function AddWorkspaceDialog({onClose}: {onClose: () => void}) {
  const sim = useSim()
  const [shell, setShell] = useState(false)
  const choose = (ws: Workspace) => {
    sim.setWorkspace(ws, shell)
    onClose()
  }
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-[460px] rounded-2xl bg-white p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900">
          Let the AI make files in this conversation
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Reports, plans, spreadsheets, code. Each Branch keeps its own version
          of the files, so you can try ideas side by side.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => choose({kind: 'app'})}
            className="rounded-xl border-2 border-violet-500 bg-violet-50 p-3 text-left hover:bg-violet-100"
          >
            <div className="text-sm font-medium text-zinc-900">
              Keep the files in the app{' '}
              <span className="ml-1 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] text-white">
                Recommended
              </span>
            </div>
            <div className="text-xs text-zinc-600">
              Nothing to set up. You can save files anywhere later, or move them
              to a folder.
            </div>
          </button>
          <button
            onClick={() => choose(PICKED_FOLDER)}
            className="rounded-xl border border-zinc-300 p-3 text-left hover:bg-zinc-50"
          >
            <div className="text-sm font-medium text-zinc-900">
              Use a folder on my computer…
            </div>
            <div className="text-xs text-zinc-600">
              For an existing project. Opens a folder picker (fakes
              “~/Documents/School search”).
            </div>
          </button>
        </div>
        <label className="mt-4 flex items-start gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={shell}
            onChange={e => setShell(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-zinc-800">
              Also let the AI run commands
            </span>{' '}
            (advanced). Needed for coding: running tests, installing packages.
          </span>
        </label>
      </div>
    </div>
  )
}

// ---------- prototype chrome ----------

export function WorkspaceDebug({onReset}: {onReset: () => void}) {
  const sim = useSim()
  const [open, setOpen] = useState(false)
  const leaf = sim.tree[sim.activeReplyId]
  const editPath = sim.workspace
    ? sim.workspace.kind === 'linked' && sim.workspace.base?.['src/App.tsx']
      ? 'src/App.tsx'
      : 'packing-list.md'
    : null
  return (
    <div className="fixed bottom-3 left-3 z-[55] flex flex-col-reverse font-mono text-[11px] text-fuchsia-950">
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-3 py-1 shadow"
      >
        PROTOTYPE · Workspace files {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mb-1 w-72 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-2.5 shadow">
          <div>
            Workspace: {sim.workspace ? sim.workspace.kind : 'none'} · shell{' '}
            {sim.shell ? 'on' : 'off'}
          </div>
          <div className="truncate">
            Active Reply: {leaf ? leaf.id : 'none'}
          </div>
          <label className="mt-1.5 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={sim.failNext}
              onChange={e => sim.setFailNext(e.target.checked)}
            />
            Fail the next Reply mid-stream
          </label>
          <div className="mt-1.5 flex items-center gap-1.5">
            Speed
            {(['slow', 'normal', 'fast'] as const).map(s => (
              <button
                key={s}
                onClick={() => sim.setSpeed(s)}
                className={`rounded border border-fuchsia-400 px-1.5 ${sim.speed === s ? 'bg-fuchsia-700 text-white' : ''}`}
              >
                {s}
              </button>
            ))}
          </div>
          {editPath && leaf && (
            <button
              onClick={() =>
                sim.userEdit(leaf.id, {
                  path: editPath,
                  op: 'modified',
                  content: `${snapshotAt(sim.tree, leaf.id, sim.workspace).get(editPath)?.content ?? ''}\n- (you added this line in your editor)`,
                })
              }
              className="mt-1.5 block rounded border border-fuchsia-400 px-2 py-0.5 text-left hover:bg-fuchsia-100"
            >
              Simulate: you edit {editPath} in the active Thread’s folder
            </button>
          )}
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={onReset}
              className="rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100"
            >
              Reset this Tree
            </button>
            {sim.workspace && (
              <button
                onClick={() => sim.setWorkspace(null)}
                className="rounded border border-fuchsia-400 px-2 py-0.5 hover:bg-fuchsia-100"
              >
                Remove Workspace
              </button>
            )}
          </div>
          <div className="mt-1.5 text-fuchsia-700">
            New Replies in a Workspace write files as they stream.
          </div>
        </div>
      )}
    </div>
  )
}
