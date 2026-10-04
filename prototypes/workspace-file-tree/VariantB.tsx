import type {Nav} from './main'

// PROTOTYPE variant B: files live in the chat slideout, as a Files tab with a Thread timeline, file tree and preview side
// by side. The sidebar is only the Tree list. Replies show file changes inline, where they happened in the text. Throw away.
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'

import {
  useSim,
  type Decor,
  type HostApi,
  DecorContext,
} from '../canvas-mode-ux/shared'
import {pathTo, type FileChange, type Turn} from '../canvas-mode-ux/tree'
import {VariantD} from '../canvas-mode-ux/VariantD'
import {
  AddWorkspaceDialog,
  FilePreview,
  FilesTree,
  gitStatusFor,
  OpCounts,
  Spinner,
  TreeList,
  UserEdits,
  WorkspaceChip,
} from './common'
import {baseName, countOps, OP_STYLE, snapshotAt} from './workspace'

export const name = 'Files tab in the chat slideout'

const SIDEBAR = 230

export function VariantB({nav}: {nav: Nav}) {
  const sim = useSim()
  const host = useRef<HostApi | null>(null)
  const [adding, setAdding] = useState(false)

  const decor = useMemo<Decor>(
    () => ({
      hostApi: host,
      leftInset: SIDEBAR,
      replyOverlay: r => (
        <ChangeTab reply={r} onClick={() => host.current?.openFiles(r.id)} />
      ),
      replyBody: (r, where) => (
        <Interleaved
          reply={r}
          where={where}
          onOpen={() => host.current?.openFiles(r.id)}
        />
      ),
      prompt: p => <UserEdits prompt={p} />,
      drawerFiles: replyId => (
        <FilesTab replyId={replyId} onAdd={() => setAdding(true)} />
      ),
    }),
    []
  )

  return (
    <DecorContext.Provider value={decor}>
      <div className="flex h-full">
        <aside
          style={{width: SIDEBAR}}
          className="flex shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 px-2 pt-3"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-zinc-900">
              Unimatrix Zero
            </span>
            <button
              title="Settings"
              className="text-zinc-400 hover:text-zinc-900"
            >
              ⚙
            </button>
          </div>
          <TreeList {...nav} compact />
        </aside>
        <div className="relative min-w-0 flex-1">
          <VariantD />
          {Object.keys(sim.tree).length > 0 && (
            <button
              onClick={() =>
                sim.workspace
                  ? host.current?.openFiles(sim.activeReplyId)
                  : setAdding(true)
              }
              className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 shadow-sm hover:bg-zinc-50"
            >
              🗂{' '}
              {sim.workspace
                ? `Files · ${snapshotAt(sim.tree, sim.activeReplyId, sim.workspace).size}`
                : 'Add files'}
            </button>
          )}
        </div>
      </div>
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </DecorContext.Provider>
  )
}

// A tab sticking out of the Reply box's top edge, like a folder tab.
function ChangeTab({reply, onClick}: {reply: Turn; onClick: () => void}) {
  const files = reply.files ?? []
  if (!files.length) return null
  const c = countOps(files)
  return (
    <button
      onClick={onClick}
      title="Show this Reply's files"
      className="nodrag absolute -top-3 left-4 z-10 flex items-center gap-1 rounded-t-md rounded-b-sm border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-800 shadow-sm hover:bg-violet-100"
    >
      {files.some(f => f.writing) ? <Spinner /> : '🗂'}
      {c.added > 0 && <span>+{c.added}</span>}
      {c.modified > 0 && <span>~{c.modified}</span>}
      {c.deleted > 0 && <span>−{c.deleted}</span>}
    </button>
  )
}

// Reply text with each file change shown at the point it happened.
function Interleaved({
  reply,
  where,
  onOpen,
}: {
  reply: Turn
  where: 'canvas' | 'drawer'
  onOpen: () => void
}) {
  const files = [...(reply.files ?? [])].sort(
    (a, b) => (a.at ?? 0) - (b.at ?? 0)
  )
  if (!files.length) return <>{reply.text}</>
  const parts: ReactNode[] = []
  let from = 0
  files.forEach((f, i) => {
    // Snap to the end of the paragraph the change landed in, so cards don't split sentences.
    const at = Math.min(reply.text.length, f.at ?? 0)
    const nl = reply.text.indexOf('\n', at)
    const cut = Math.max(from, nl === -1 ? reply.text.length : nl)
    parts.push(<span key={`t${i}`}>{reply.text.slice(from, cut)}</span>)
    parts.push(
      <FileCard
        key={f.path}
        change={f}
        reply={reply}
        compact={where === 'canvas'}
        onOpen={onOpen}
      />
    )
    from = cut
  })
  parts.push(<span key="end">{reply.text.slice(from)}</span>)
  return <>{parts}</>
}

function FileCard({
  change,
  reply,
  compact,
  onOpen,
}: {
  change: FileChange
  reply: Turn
  compact: boolean
  onOpen: () => void
}) {
  const sim = useSim()
  const s = OP_STYLE[change.op]
  if (compact)
    return (
      <button
        onClick={onOpen}
        className="nodrag my-1 flex w-full items-center gap-1.5 rounded-md bg-zinc-50 px-2 py-1 text-left text-xs whitespace-normal text-zinc-600 hover:bg-zinc-100"
      >
        {change.writing ? (
          <Spinner />
        ) : (
          <span className={`font-mono ${s.text}`}>{s.sign}</span>
        )}
        {change.writing ? 'Writing' : s.verb}{' '}
        <span className="font-mono text-zinc-900">{change.path}</span>
      </button>
    )
  const content =
    change.content ??
    snapshotAt(sim.tree, reply.parentId ?? '', sim.workspace).get(change.path)
      ?.content ??
    ''
  return (
    <button
      onClick={onOpen}
      className="my-2 block w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-left whitespace-normal shadow-sm hover:border-violet-300"
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
        {change.writing ? (
          <Spinner />
        ) : (
          <span className={`h-2 w-2 rounded-full ${s.bg}`} />
        )}
        {change.writing ? 'Writing' : s.verb}{' '}
        <span className="font-mono text-zinc-900">{change.path}</span>
      </div>
      {change.op !== 'deleted' && !content.startsWith('<svg') && (
        <pre className="max-h-16 overflow-hidden px-2.5 py-1.5 font-mono text-[11px] leading-snug text-zinc-500">
          {content.split('\n').slice(0, 4).join('\n')}
        </pre>
      )}
    </button>
  )
}

// The slideout's Files tab: a timeline of the Thread's Replies, then tree and preview side by side.
function FilesTab({replyId, onAdd}: {replyId: string; onAdd: () => void}) {
  const sim = useSim()
  const replies = pathTo(sim.tree, replyId).filter(t => t.kind === 'reply')
  const [at, setAt] = useState(replyId)
  const [path, setPath] = useState<string | null>(null)
  useEffect(() => setAt(replyId), [replyId])
  if (!sim.workspace)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
        <div className="text-3xl">🗂</div>
        <div className="font-medium text-zinc-800">
          This conversation has no files
        </div>
        <p className="text-sm text-zinc-500">
          Add a Workspace and the AI can create and edit files. Every Branch
          keeps its own copy.
        </p>
        <button
          onClick={onAdd}
          className="mt-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
        >
          Add files to this Tree
        </button>
      </div>
    )
  const turn = sim.tree[at] ?? sim.tree[replyId]!
  const pending = turn.id === replyId ? (sim.pendingEdits[replyId] ?? []) : []
  const snap = snapshotAt(sim.tree, turn.id, sim.workspace, pending)
  const deleted = (turn.files ?? [])
    .filter(f => f.op === 'deleted')
    .map(f => f.path)
  const paths = [...snap.keys(), ...deleted].sort()
  const shown =
    path && (snap.has(path) || deleted.includes(path))
      ? path
      : (turn.files?.[0]?.path ?? paths[0] ?? null)
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-zinc-200 px-4 py-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>
            Files after Reply {replies.findIndex(r => r.id === turn.id) + 1} of{' '}
            {replies.length}
          </span>
          <WorkspaceChip workspace={sim.workspace} shell={sim.shell} />
        </div>
        <div className="mt-2 flex items-center">
          {replies.map((r, i) => {
            const changed = (r.files?.length ?? 0) > 0
            return (
              <div
                key={r.id}
                className="flex flex-1 items-center last:flex-none"
              >
                <button
                  onClick={() => setAt(r.id)}
                  title={`${sim.tree[r.parentId!]?.text.slice(0, 60)}${changed ? `\n${r.files!.map(f => `${OP_STYLE[f.op].verb} ${f.path}`).join('\n')}` : ''}`}
                  className={`relative flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] ${r.id === turn.id ? 'bg-zinc-900 text-white' : changed ? 'bg-violet-100 text-violet-800 hover:bg-violet-200' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'}`}
                >
                  {changed ? r.files!.length : i + 1}
                </button>
                {i < replies.length - 1 && (
                  <div className="h-px flex-1 bg-zinc-200" />
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-1.5 truncate text-[11px] text-zinc-500">
          “{sim.tree[turn.parentId!]?.text.slice(0, 70)}”{' '}
          {(turn.files?.length ?? 0) > 0 && (
            <OpCounts files={turn.files} className="ml-1" />
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[250px] shrink-0 border-r border-zinc-200">
          {paths.length ? (
            <FilesTree
              paths={paths}
              status={[...gitStatusFor(turn.files), ...gitStatusFor(pending)]}
              selected={shown}
              onSelect={setPath}
              decorate={p => (pending.some(f => f.path === p) ? 'you' : null)}
            />
          ) : (
            <p className="p-4 text-xs text-zinc-500">
              No files yet at this Turn.
            </p>
          )}
        </div>
        {shown ? (
          <FilePreview
            key={`${turn.id}${shown}`}
            path={shown}
            turnId={turn.id}
            className="min-w-0 flex-1"
            compact
          />
        ) : (
          <div className="flex-1" />
        )}
      </div>
      {turn.files?.some(f => f.writing) && (
        <div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-1.5 text-[11px] text-violet-700">
          <Spinner /> Writing {baseName(turn.files.find(f => f.writing)!.path)}…
        </div>
      )}
    </div>
  )
}
