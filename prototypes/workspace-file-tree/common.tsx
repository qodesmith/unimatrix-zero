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
  type Turn,
  type Workspace,
} from '../canvas-mode-ux/tree'
import {
  baseName,
  contentBefore,
  countOps,
  extOf,
  fileKind,
  formatSize,
  isLeaf,
  isMedia,
  KEEP_VERSION_CAP,
  KIND_ICON,
  MEDIA_PREVIEW_CAP,
  mediaSrc,
  modifiedLabel,
  OP_STYLE,
  PICKED_FOLDER,
  sizeOf,
  snapshotAt,
  TEXT_PREVIEW_CAP,
  typeName,
  type FileKind,
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

const TRUNCATE_AT = 4000

export function FileBody({
  path,
  content,
  size = sizeOf({content}),
  modified,
  notKept,
}: {
  path: string
  content: string
  size?: number
  modified?: string
  // A large binary at an earlier Turn: no snapshot of it exists.
  notKept?: boolean
}) {
  const toast = useToast()
  const [broken, setBroken] = useState(false)
  const [zoom, setZoom] = useState(false)
  const kind = fileKind(path, content)
  const card = (note?: string) => (
    <FileCard
      path={path}
      kind={kind}
      size={size}
      modified={modified}
      note={note}
    />
  )
  if (notKept) return card('Files this big only keep their latest version.')
  if (isMedia(kind) && size > MEDIA_PREVIEW_CAP)
    return card(
      `Too big to preview here (over ${formatSize(MEDIA_PREVIEW_CAP)}).`
    )
  if (kind === 'office' || (kind !== 'binary' && isMedia(kind) && !content))
    return (
      <OsPreviewCard path={path} kind={kind} size={size} modified={modified} />
    )
  if (kind === 'binary') return card('The app can’t preview this type of file.')
  if (kind === 'image')
    return (
      <div>
        <button
          onClick={() => setZoom(z => !z)}
          className="mb-1.5 text-[11px] text-violet-700 hover:underline"
        >
          {zoom ? 'Fit to window' : 'Actual size'}
        </button>
        <img
          src={mediaSrc(content)}
          alt={path}
          onClick={() => setZoom(z => !z)}
          className={`rounded-lg border border-zinc-200 bg-white ${zoom ? 'max-w-none cursor-zoom-out' : 'max-h-[50vh] max-w-full cursor-zoom-in'}`}
        />
      </div>
    )
  if (kind === 'audio' || kind === 'video') {
    if (broken)
      return card(
        kind === 'video'
          ? 'This video’s codec can’t play here.'
          : 'This audio format can’t play here.'
      )
    return kind === 'audio' ? (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-zinc-700">
          <span className="text-xl">{KIND_ICON.audio}</span>
          {typeName(path)} · {formatSize(size)}
        </div>
        <audio
          controls
          src={content}
          onError={() => setBroken(true)}
          className="w-full"
        />
      </div>
    ) : (
      <video
        controls
        src={content}
        onError={() => setBroken(true)}
        className="max-h-[50vh] w-full rounded-lg bg-black"
      />
    )
  }
  if (kind === 'pdf')
    return (
      <iframe
        src={content}
        title={path}
        className="h-[60vh] w-full rounded-lg border border-zinc-200"
      />
    )
  const truncated = size > TEXT_PREVIEW_CAP
  const text = truncated
    ? content.slice(0, content.lastIndexOf('\n', TRUNCATE_AT))
    : content
  const body =
    kind === 'md' ? (
      <Markdown text={text} />
    ) : kind === 'csv' ? (
      <Csv text={text} />
    ) : (
      <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs leading-relaxed text-zinc-800">
        {text}
      </pre>
    )
  if (!truncated) return body
  return (
    <>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        Showing the first {formatSize(text.length)} of {formatSize(size)}.
        <ActionButton
          onClick={() => toast(`Opens ${baseName(path)} in its default app`)}
        >
          Open to see the rest
        </ActionButton>
      </div>
      {body}
    </>
  )
}

const OFFICE_TINT: Record<string, string> = {
  docx: 'bg-blue-600',
  pages: 'bg-orange-500',
  xlsx: 'bg-emerald-600',
  numbers: 'bg-emerald-500',
  pptx: 'bg-orange-600',
  key: 'bg-sky-500',
  psd: 'bg-indigo-900',
  sketch: 'bg-amber-400',
  fig: 'bg-zinc-900',
}

function FileFacts({
  path,
  size,
  modified,
}: {
  path: string
  size: number
  modified?: string
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-zinc-900">
        {baseName(path)}
      </div>
      <div className="text-xs text-zinc-500">
        {typeName(path)} · {formatSize(size)}
      </div>
      {modified && (
        <div className="text-xs text-zinc-500">Modified {modified}</div>
      )}
    </div>
  )
}

// Formats macOS can show but the app can't: a thumbnail (from the OS in the real app) and Quick Look.
function OsPreviewCard({
  path,
  kind,
  size,
  modified,
}: {
  path: string
  kind: FileKind
  size: number
  modified?: string
}) {
  const toast = useToast()
  const ext = extOf(path)
  return (
    <div className="flex items-start gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="relative flex h-36 w-28 shrink-0 flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex-1 space-y-1.5 p-2.5">
          {[90, 70, 85, 60, 75, 40].map((w, i) => (
            <div
              key={i}
              style={{width: `${w}%`}}
              className="h-1 rounded bg-zinc-200"
            />
          ))}
        </div>
        <div
          className={`py-1 text-center font-mono text-[10px] font-bold text-white ${OFFICE_TINT[ext] ?? 'bg-zinc-500'}`}
        >
          {ext.toUpperCase() || KIND_ICON[kind]}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <FileFacts path={path} size={size} modified={modified} />
        <p className="text-xs text-zinc-500">
          The app can’t show this file, but macOS can.
        </p>
        <div>
          <ActionButton
            onClick={() =>
              toast(
                `Opens ${baseName(path)} in macOS Quick Look (Electron’s previewFile)`
              )
            }
          >
            Quick Look
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

function FileCard({
  path,
  kind,
  size,
  modified,
  note,
}: {
  path: string
  kind: FileKind
  size: number
  modified?: string
  note?: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white text-3xl shadow-sm">
        {KIND_ICON[kind]}
      </div>
      <div className="min-w-0">
        <FileFacts path={path} size={size} modified={modified} />
        {note && <p className="mt-1.5 text-xs text-amber-800">{note}</p>}
      </div>
    </div>
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
  const size = file?.size ?? sizeOf({content})
  const notKept =
    !live && isMedia(fileKind(path, content)) && size > KEEP_VERSION_CAP
  return (
    <div className={`flex min-h-0 flex-col bg-white ${className}`}>
      <div className="flex items-start gap-2 border-b border-zinc-200 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-900">
            {baseName(path)}
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {path}
            {content !== undefined && ` · ${formatSize(size)}`}
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
      {!live && !deleted && !notKept && (
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
          <FileBody
            key={`${turnId}:${path}`}
            path={path}
            content={content}
            size={size}
            modified={
              changedBy ? modifiedLabel(changedBy.createdAt) : undefined
            }
            notKept={notKept}
          />
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
          ) : notKept ? (
            <span className="text-zinc-500">
              No earlier version kept (over the {formatSize(KEEP_VERSION_CAP)}{' '}
              limit)
            </span>
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
  // Files kept in the app are the default, so only a linked folder gets a label.
  if (workspace.kind === 'app' && !shell) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800"
      title={
        shell
          ? 'The AI can write files and run commands'
          : 'The AI can write files'
      }
    >
      {workspace.kind === 'linked' && `🔗 ${workspace.path}`}
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

// Files as chips under the Reply text, like attachments on a Prompt.
export function FileChips({
  reply,
  onOpen,
}: {
  reply: Turn
  onOpen: (path: string) => void
}) {
  const files = reply.files ?? []
  if (!files.length && !reply.commands?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 pb-2 whitespace-normal">
      {files.map(f => (
        <Chip key={f.path} change={f} onClick={() => onOpen(f.path)} />
      ))}
      {reply.commands?.map((c, i) => (
        <span
          key={i}
          className="flex h-10 items-center rounded-lg border border-zinc-200 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-100"
        >
          $ {c.cmd}{' '}
          <span
            className={`ml-1.5 ${c.result.includes('failed') ? 'text-red-300' : 'text-emerald-300'}`}
          >
            {c.result}
          </span>
        </span>
      ))}
    </div>
  )
}

function Chip({change, onClick}: {change: FileChange; onClick: () => void}) {
  const s = OP_STYLE[change.op]
  const kind = fileKind(change.path, change.content)
  return (
    <button
      onClick={onClick}
      title={`${s.verb} ${change.path}`}
      className={`nodrag relative flex h-10 max-w-[190px] items-center gap-1.5 overflow-hidden rounded-lg border bg-white pr-2 text-left ${change.op === 'deleted' ? 'border-red-200 opacity-60' : 'border-zinc-200 hover:border-violet-300'}`}
    >
      <span className={`h-full w-1 shrink-0 ${s.bg}`} />
      {change.writing ? (
        <Spinner />
      ) : kind === 'image' && change.content ? (
        <img
          src={mediaSrc(change.content)}
          alt=""
          className="h-8 w-8 rounded object-cover"
        />
      ) : kind === 'video' ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800 text-[10px] text-white">
          ▶
        </span>
      ) : ['audio', 'pdf', 'office', 'binary'].includes(kind) ? (
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm ${kind === 'pdf' ? 'bg-red-50' : kind === 'audio' ? 'bg-violet-50' : 'bg-zinc-100'}`}
        >
          {kind === 'office' ? (
            <span className="font-mono text-[8px] font-bold text-zinc-600">
              {extOf(change.path).toUpperCase()}
            </span>
          ) : (
            KIND_ICON[kind]
          )}
        </span>
      ) : (
        <span className="font-mono text-[9px] font-bold text-zinc-500">
          {extOf(change.path).toUpperCase().slice(0, 4)}
        </span>
      )}
      <span className="min-w-0">
        <span
          className={`block truncate text-xs text-zinc-800 ${change.op === 'deleted' ? 'line-through' : ''}`}
        >
          {baseName(change.path)}
        </span>
        <span className={`block text-[10px] ${s.text}`}>
          {change.writing
            ? 'writing…'
            : `${s.verb.toLowerCase()}${change.op === 'deleted' ? '' : ` · ${formatSize(sizeOf(change))}`}`}
        </span>
      </span>
    </button>
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
