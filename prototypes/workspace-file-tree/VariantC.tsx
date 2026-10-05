import type {FileChange, FileOp, Tree, Turn} from '../canvas-mode-ux/tree'
import type {Nav} from './main'
// PROTOTYPE variant C: the alternative to "the file tree follows the selected Turn". Folders mirror the Tree, one per
// Segment (the run of Turns between Forks), and the canvas draws each Segment as a band. Replies list their files as
// chips, like Prompt attachments. Previews open in a modal. Throw away.
import type {Node, NodeProps} from '@xyflow/react'

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
  FilePreview,
  FilesTree,
  Spinner,
  TreeList,
  UserEdits,
  WorkspaceChip,
} from './common'
import {
  baseName,
  extOf,
  fileKind,
  formatSize,
  KIND_ICON,
  mediaSrc,
  OP_STYLE,
  segmentsOf,
  sizeOf,
  snapshotAt,
  type Segment,
} from './workspace'

export const name = 'Folders mirror the Tree, Segment bands'

const SIDEBAR = 300
const BAND_PAD = 18
const BAND_COLORS = ['#f5f3ff', '#ecfeff', '#fef9c3', '#fce7f3', '#ecfccb']

type Band = {w: number; h: number; label: string; color: string}

function BandNode({data}: NodeProps<Node<Band>>) {
  return (
    <div
      style={{width: data.w, height: data.h, background: data.color}}
      className="rounded-3xl border border-black/5"
    >
      <div className="absolute -top-5 left-3 text-[11px] font-medium whitespace-nowrap text-zinc-500">
        {data.label}
      </div>
    </div>
  )
}

const extraNodeTypes = {band: BandNode}

// Net effect of a Segment's Replies on each file.
function segmentChanges(tree: Tree, seg: Segment) {
  const net = new Map<string, FileOp>()
  for (const id of seg.turnIds)
    for (const f of tree[id]?.files ?? []) {
      const prev = net.get(f.path)
      if (prev === 'added' && f.op === 'deleted') net.delete(f.path)
      else if (prev === 'added') continue
      else net.set(f.path, f.op)
    }
  return net
}

const folderName = (seg: Segment, i: number) =>
  `${i + 1} · ${seg.title.replace(/[/\\]/g, '-')}`

// One folder per Segment, nested like the Tree, each holding the files as they were at the Segment's last Reply.
function mirrorPaths(
  tree: Tree,
  segments: Segment[],
  ws: Parameters<typeof snapshotAt>[2]
) {
  const dir: Record<string, string> = {}
  const paths: string[] = []
  const status: {path: string; status: FileOp}[] = []
  const lookup: Record<string, {seg: Segment; file?: string}> = {}
  segments.forEach((seg, i) => {
    const parent = seg.parentSegmentId ? dir[seg.parentSegmentId] : ''
    const d = `${parent}${folderName(seg, i)}/`
    dir[seg.id] = d
    paths.push(d)
    lookup[d.slice(0, -1)] = {seg}
    lookup[d] = {seg}
    if (!seg.endReplyId) return
    const net = segmentChanges(tree, seg)
    for (const file of snapshotAt(tree, seg.endReplyId, ws).keys()) {
      paths.push(d + file)
      lookup[d + file] = {seg, file}
      const op = net.get(file)
      if (op) status.push({path: d + file, status: op})
    }
  })
  return {paths, status, lookup}
}

export function VariantC({nav}: {nav: Nav}) {
  const sim = useSim()
  const host = useRef<HostApi | null>(null)
  const [preview, setPreview] = useState<{path: string; turnId: string} | null>(
    null
  )
  const [adding, setAdding] = useState(false)
  const [bands, setBands] = useState(true)
  const bandsRef = useRef(bands)
  bandsRef.current = bands

  const decor = useMemo<Decor>(
    () => ({
      hostApi: host,
      leftInset: SIDEBAR,
      extraNodeTypes,
      extraNodes: (nodes, tree) =>
        bandsRef.current ? bandNodes(nodes, tree) : [],
      replyBottom: r => (
        <FileChips
          reply={r}
          onOpen={path => setPreview({path, turnId: r.id})}
        />
      ),
      prompt: p => <UserEdits prompt={p} />,
    }),
    []
  )
  const segments = useMemo(() => segmentsOf(sim.tree), [sim.tree])
  const mirror = useMemo(
    () => mirrorPaths(sim.tree, segments, sim.workspace),
    [sim.tree, segments, sim.workspace]
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
          <div className="max-h-[32%] overflow-y-auto px-2">
            <TreeList {...nav} />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-zinc-200 px-3 pt-2.5 pb-1.5">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              Files by Segment
            </span>
            <WorkspaceChip workspace={sim.workspace} shell={sim.shell} />
          </div>
          <label className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={bands}
              onChange={e => setBands(e.target.checked)}
            />
            Show Segments on the canvas
          </label>
          <div className="min-h-0 flex-1">
            {!sim.workspace ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-xs text-zinc-500">Plain chat: no files.</p>
                <button
                  onClick={() => setAdding(true)}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700"
                >
                  Add files to this Tree
                </button>
              </div>
            ) : (
              <FilesTree
                paths={mirror.paths}
                status={mirror.status}
                selected={null}
                onSelect={p => {
                  const hit = mirror.lookup[p]
                  if (!hit?.seg.endReplyId) return
                  host.current?.jumpTo(hit.seg.endReplyId)
                  if (hit.file)
                    setPreview({path: hit.file, turnId: hit.seg.endReplyId})
                }}
              />
            )}
          </div>
        </aside>
        <div className="relative min-w-0 flex-1">
          <VariantD key={String(bands)} />
        </div>
      </div>
      {preview && sim.tree[preview.turnId] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-10"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-full w-[720px] flex-col overflow-hidden rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <FilePreview
              path={preview.path}
              turnId={preview.turnId}
              onClose={() => setPreview(null)}
              className="min-h-[360px]"
            />
          </div>
        </div>
      )}
      {adding && <AddWorkspaceDialog onClose={() => setAdding(false)} />}
    </DecorContext.Provider>
  )
}

function bandNodes(nodes: Node[], tree: Tree): Node[] {
  const segs = segmentsOf(tree)
  const out: Node[] = []
  segs.forEach((seg, i) => {
    const members = nodes.filter(
      n => seg.turnIds.includes(n.id) && !n.className
    )
    if (!members.length) return
    const box = members.reduce(
      (b, n) => {
        const w = n.measured?.width ?? 440
        const h = n.measured?.height ?? 80
        return {
          x1: Math.min(b.x1, n.position.x),
          y1: Math.min(b.y1, n.position.y),
          x2: Math.max(b.x2, n.position.x + w),
          y2: Math.max(b.y2, n.position.y + h),
        }
      },
      {x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity}
    )
    const files = segmentChanges(tree, seg).size
    const turns = seg.turnIds.length
    out.push({
      id: `band-${seg.id}`,
      type: 'band',
      position: {x: box.x1 - BAND_PAD, y: box.y1 - BAND_PAD},
      data: {
        w: box.x2 - box.x1 + BAND_PAD * 2,
        h: box.y2 - box.y1 + BAND_PAD * 2,
        label: `Segment ${i + 1} · ${turns / 2} Turn${turns === 2 ? '' : 's'}${files ? ` · ${files} file${files === 1 ? '' : 's'} changed` : ''}`,
        color: BAND_COLORS[i % BAND_COLORS.length]!,
      } satisfies Band,
      zIndex: -1,
      selectable: false,
      draggable: false,
      style: {pointerEvents: 'none'},
    })
  })
  return out
}

// Files as chips under the Reply text, like attachments on a Prompt.
function FileChips({
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
