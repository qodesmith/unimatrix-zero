import type {Turn} from '../canvas-mode-ux/tree'
import type {Nav} from './main'

// PROTOTYPE variant A: one sidebar, Trees above and the Workspace's files below. The file tree follows the Turn
// selected on the canvas. Canvas Replies list their files as chips; the chat slideout lists every file change. Throw away.
import {useMemo, useRef, useState} from 'react'

import {
  useSim,
  type Decor,
  type HostApi,
  DecorContext,
} from '../canvas-mode-ux/shared'
import {VariantD} from '../canvas-mode-ux/VariantD'
import {
  AddWorkspaceDialog,
  FileChips,
  FilePreview,
  FilesTree,
  gitStatusFor,
  OpCounts,
  Spinner,
  TreeList,
  UserEdits,
  WorkspaceChip,
} from './common'
import {formatSize, isLeaf, OP_STYLE, sizeOf, snapshotAt} from './workspace'

export const name = 'Sidebar: Trees above, files below'

const SIDEBAR = 290

// `turnId: null` follows whatever Turn is selected.
type Preview = {path: string; turnId: string | null}

export function VariantA({nav}: {nav: Nav}) {
  const sim = useSim()
  const host = useRef<HostApi | null>(null)
  const [drawerReply, setDrawerReply] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [adding, setAdding] = useState(false)
  const focus = drawerReply ?? sim.activeReplyId

  const decor = useMemo<Decor>(
    () => ({
      onFocusReply: setDrawerReply,
      hostApi: host,
      leftInset: SIDEBAR,
      replyBottom: (r, where) =>
        where === 'canvas' ? (
          <FileChips
            reply={r}
            onOpen={path => setPreview({path, turnId: r.id})}
          />
        ) : null,
      replyTop: (r, where) =>
        where === 'drawer' ? (
          <FileActivity
            reply={r}
            onOpen={path => setPreview({path, turnId: r.id})}
          />
        ) : null,
      prompt: p => <UserEdits prompt={p} />,
      emptyExtra: <NewTreeFilesHint onAdd={() => setAdding(true)} />,
    }),
    []
  )

  return (
    <DecorContext.Provider value={decor}>
      <div className="flex h-full">
        <aside
          style={{width: SIDEBAR}}
          className="flex shrink-0 flex-col border-r border-zinc-200 bg-white"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
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
          <div className="max-h-[38%] overflow-y-auto px-2">
            <TreeList {...nav} />
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-zinc-200">
            <FilesPanel
              focus={focus}
              following={!drawerReply}
              onBackToLatest={() => host.current?.select(null)}
              onOpen={path => setPreview({path, turnId: null})}
              selected={preview?.turnId === null ? preview.path : null}
              onAdd={() => setAdding(true)}
            />
          </div>
        </aside>
        <div className="relative min-w-0 flex-1">
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
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </DecorContext.Provider>
  )
}

export function FilesPanel({
  focus,
  following,
  onBackToLatest,
  onOpen,
  selected,
  onAdd,
}: {
  focus: string
  following: boolean
  onBackToLatest: () => void
  onOpen: (path: string) => void
  selected: string | null
  onAdd: () => void
}) {
  const sim = useSim()
  if (!sim.workspace)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-2xl">🗂</div>
        <div className="text-sm font-medium text-zinc-800">
          No files in this conversation
        </div>
        <p className="text-xs text-zinc-500">
          Give it a Workspace and the AI can make documents, spreadsheets and
          code as you talk. Each Branch keeps its own version.
        </p>
        <button
          onClick={onAdd}
          className="mt-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
        >
          Add files to this Tree
        </button>
      </div>
    )
  const reply = sim.tree[focus]
  const pending = sim.pendingEdits[focus] ?? []
  const snap = snapshotAt(sim.tree, focus, sim.workspace, pending)
  const deleted = (reply?.files ?? [])
    .filter(f => f.op === 'deleted')
    .map(f => f.path)
  const paths = [...snap.keys(), ...deleted].sort()
  const live = reply ? isLeaf(sim.tree, reply.id) : true
  const prompt = reply?.parentId ? sim.tree[reply.parentId] : undefined
  return (
    <>
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
            Files
          </span>
          <WorkspaceChip workspace={sim.workspace} shell={sim.shell} />
        </div>
        {reply && (
          <div className="mt-1.5 rounded-lg bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
              />
              {live
                ? 'Latest files in this Thread'
                : 'Files at an earlier Turn'}
              <span className="flex-1" />
              {!following && (
                <button
                  onClick={onBackToLatest}
                  className="text-violet-700 hover:underline"
                >
                  Back to active
                </button>
              )}
            </div>
            <div className="mt-0.5 truncate text-zinc-500">
              after “{prompt?.text.slice(0, 48) || '…'}”
            </div>
            {(reply.files?.length ?? 0) > 0 && (
              <div className="mt-0.5">
                This Reply: <OpCounts files={reply.files} />
              </div>
            )}
            {pending.length > 0 && (
              <div className="mt-0.5 text-sky-700">
                ✎ You edited {pending.length} since
              </div>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {paths.length ? (
          <FilesTree
            paths={paths}
            status={[...gitStatusFor(reply?.files), ...gitStatusFor(pending)]}
            selected={selected}
            onSelect={p =>
              snap.has(p) || deleted.includes(p) ? onOpen(p) : undefined
            }
            decorate={p => {
              if (pending.some(f => f.path === p)) return 'you'
              const size = snap.get(p)?.size ?? 0
              return size >= 1_000_000 ? formatSize(size) : null
            }}
          />
        ) : (
          <p className="px-4 py-6 text-center text-xs text-zinc-500">
            No files yet. Try “put this in a document”.
          </p>
        )}
      </div>
    </>
  )
}

// Chat slideout: a full list of what the Reply did, above its text.
function FileActivity({
  reply,
  onOpen,
}: {
  reply: Turn
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const files = reply.files ?? []
  const commands = reply.commands ?? []
  if (!files.length && !commands.length) return null
  return (
    <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 text-xs whitespace-normal">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-zinc-600"
      >
        {open ? '▾' : '▸'} Worked on {files.length} file
        {files.length === 1 ? '' : 's'}
        {commands.length > 0 &&
          `, ran ${commands.length} command${commands.length === 1 ? '' : 's'}`}
        <OpCounts files={files} className="ml-auto" />
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-2.5 py-1.5">
          {files.map(f => (
            <button
              key={f.path}
              onClick={() => onOpen(f.path)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-white"
            >
              {f.writing ? (
                <Spinner />
              ) : (
                <span className={`w-3 font-mono ${OP_STYLE[f.op].text}`}>
                  {OP_STYLE[f.op].sign}
                </span>
              )}
              <span className="text-zinc-500">
                {f.writing ? 'Writing' : OP_STYLE[f.op].verb}
              </span>
              <span className="truncate font-mono text-zinc-800">{f.path}</span>
              {f.op !== 'deleted' && !f.writing && (
                <span className="ml-auto shrink-0 text-zinc-400">
                  {formatSize(sizeOf(f))}
                </span>
              )}
            </button>
          ))}
          {commands.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-1 py-0.5 font-mono"
            >
              <span className="w-3 text-zinc-400">$</span>
              <span className="text-zinc-800">{c.cmd}</span>
              <span
                className={
                  c.result.includes('failed')
                    ? 'text-red-600'
                    : 'text-emerald-700'
                }
              >
                {c.result}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NewTreeFilesHint({onAdd}: {onAdd: () => void}) {
  const sim = useSim()
  return (
    <div className="mt-3 flex justify-center">
      {sim.workspace ? (
        <WorkspaceChip workspace={sim.workspace} shell={sim.shell} />
      ) : (
        <button
          onClick={onAdd}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          ＋ Let the AI make files
        </button>
      )}
    </div>
  )
}
