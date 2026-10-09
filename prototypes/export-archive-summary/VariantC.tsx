import type {Decor} from '../canvas-mode-ux/shared'
import type {Nav} from './main'

// PROTOTYPE variant C: one "Take a copy" dialog for all three (Markdown, Archive, Summary), reached by right-clicking a
// Reply or Tree, or from a ⌘K palette. The Summary appears on the canvas as a dashed ghost card beside its Reply (or
// above the root), visibly outside the Tree. Backups is its own Settings section; restore compares side by side. Throw away.
import {useReactFlow, type Node, type NodeProps} from '@xyflow/react'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {childrenOf, simCache} from '../canvas-mode-ux/tree'
import {
  ArchiveBody,
  Btn,
  DropOverlay,
  ExportBody,
  KnobsPanel,
  Menu,
  Modal,
  RestoreBody,
  SettingsPage,
  SummaryActions,
  SummaryOptions,
  SummaryProgress,
  summaryTitle,
  SummaryText,
  type MenuItem,
} from './common'
import {useFlows, type Flows} from './flows'
import {SIDEBAR, Shell} from './layout'

export const name = 'Right-click, ⌘K and a ghost Summary card'

type Scope = {kind: 'thread'; replyId: string} | {kind: 'tree'}
type Take = {scope: Scope; pick: 'export' | 'archive' | 'summary' | null}

const GhostContext = createContext<Flows | null>(null)
const GHOST_TYPES = {summary: GhostCard}

export function VariantC({nav}: {nav: Nav}) {
  const f = useFlows(nav)
  const [take, setTake] = useState<Take | null>(null)
  const [ctx, setCtx] = useState<{
    x: number
    y: number
    items: MenuItem[]
  } | null>(null)
  const [palette, setPalette] = useState(false)
  const [drawerReply, setDrawerReply] = useState<string | null>(null)
  const live = useRef(f)
  live.current = f

  // Ghost card sits beside the anchor node. Only the anchor changes the node list; the card reads the run from context.
  const anchor = f.summary
    ? f.summary.kind === 'thread'
      ? f.summary.replyId
      : 'root'
    : null
  const rf = useReactFlow()
  useEffect(() => {
    if (!anchor) return
    const t = setTimeout(
      () =>
        rf.fitView({
          nodes: [{id: 'ghost-summary'}],
          maxZoom: 1,
          duration: 300,
          padding: 0.4,
        }),
      80
    )
    return () => clearTimeout(t)
  }, [anchor, rf])
  const decor = useMemo<Partial<Decor>>(
    () => ({
      extraNodeTypes: GHOST_TYPES,
      extraNodes: (nodes, tree) => {
        if (!anchor) return []
        const root = Object.values(tree).find(t => !t.parentId)
        const id = anchor === 'root' ? root?.id : anchor
        const t = id ? tree[id] : undefined
        const n =
          nodes.find(x => x.id === id) ?? nodes.find(x => x.id === t?.parentId)
        if (!n) return []
        const w = n.measured?.width ?? 440
        const position =
          anchor === 'root'
            ? {x: n.position.x - 520, y: n.position.y}
            : {x: n.position.x + w + 60, y: n.position.y}
        return [
          {
            id: 'ghost-summary',
            type: 'summary',
            position,
            data: {},
            draggable: false,
            selectable: false,
          } as Node,
        ]
      },
    }),
    [anchor]
  )

  // Right-click on a Reply (canvas or slideout) or a Tree row.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      const turnEl = el.closest<HTMLElement>('[data-turn]')
      const treeEl = el.closest<HTMLElement>('[data-tree]')
      let items: MenuItem[] | null = null
      if (turnEl) {
        // A Prompt stands for its Reply.
        const tree = simCache.get(live.current.treeKey)?.tree ?? {}
        const t = tree[turnEl.dataset.turn!]
        const reply = t?.kind === 'reply' ? t : t && childrenOf(tree, t.id)[0]
        if (reply && reply.status !== 'streaming' && reply.status !== 'failed')
          items = replyItems(reply.id)
      } else if (treeEl) items = treeItems(treeEl.dataset.tree!)
      if (!items) return
      e.preventDefault()
      setCtx({x: e.clientX, y: e.clientY, items})
    }
    window.addEventListener('contextmenu', onCtx)
    return () => window.removeEventListener('contextmenu', onCtx)
  }, [])

  // ⌘K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function replyItems(id: string): MenuItem[] {
    return [
      {
        label: 'Summarize up to here',
        onClick: () => live.current.summarizeThread(id),
      },
      {
        label: 'Take a copy of this Thread…',
        onClick: () =>
          setTake({scope: {kind: 'thread', replyId: id}, pick: null}),
      },
      {label: 'Copy as Markdown', onClick: () => live.current.copyThread(id)},
    ]
  }
  function treeItems(key: string): MenuItem[] {
    const go = (pick: Take['pick']) => () => {
      if (key !== live.current.treeKey) nav.onPick(key)
      setTake({scope: {kind: 'tree'}, pick})
    }
    return [
      {label: 'Take a copy…', onClick: go(null)},
      'sep',
      {
        label: 'Summarize this Tree',
        onClick: () => live.current.summarizeTree(key),
      },
      {label: 'Export as Markdown…', onClick: go('export')},
      {label: 'Archive…', onClick: go('archive')},
    ]
  }

  return (
    <GhostContext.Provider value={f}>
      <Shell
        nav={nav}
        decor={decor}
        onGear={f.openSettings}
        onDrawerReply={setDrawerReply}
        sidebarFooter={
          <button
            onClick={() => setPalette(true)}
            className="m-2 flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50"
          >
            <span className="flex-1">Do anything…</span>
            <kbd className="rounded bg-zinc-100 px-1 font-mono">⌘K</kbd>
          </button>
        }
      >
        {ctx && (
          <Menu
            items={ctx.items}
            onClose={() => setCtx(null)}
            style={{position: 'fixed', left: ctx.x, top: ctx.y}}
          />
        )}
        {palette && (
          <Palette
            onClose={() => setPalette(false)}
            actions={[
              {label: `Summarize “${f.title}”`, run: () => f.summarizeTree()},
              ...(drawerReply
                ? [
                    {
                      label: 'Summarize up to the open Reply',
                      run: () => f.summarizeThread(drawerReply),
                    },
                    {
                      label: 'Take a copy of the open Thread…',
                      run: () =>
                        setTake({
                          scope: {kind: 'thread', replyId: drawerReply},
                          pick: null,
                        }),
                    },
                    {
                      label: 'Copy the open Thread as Markdown',
                      run: () => f.copyThread(drawerReply),
                    },
                  ]
                : []),
              {
                label: `Export “${f.title}” as Markdown…`,
                run: () => setTake({scope: {kind: 'tree'}, pick: 'export'}),
              },
              {
                label: `Archive “${f.title}”…`,
                run: () => setTake({scope: {kind: 'tree'}, pick: 'archive'}),
              },
              {label: 'Archive everything…', run: f.archiveEverything},
              {label: 'Restore from Archive…', run: f.pickArchive},
              {label: 'Open Settings', run: f.openSettings},
            ]}
          />
        )}
        {take && (
          <TakeDialog
            take={take}
            f={f}
            onPick={pick => setTake({...take, pick})}
            onClose={() => setTake(null)}
          />
        )}
        {f.archiving?.kind === 'everything' && (
          <Modal onClose={f.closeArchive}>
            <h2 className="mb-1 text-base font-semibold text-zinc-900">
              Archive everything
            </h2>
            <ArchiveBody target={f.archiving} onDone={f.closeArchive} />
          </Modal>
        )}
        {f.settings && (
          <SettingsPage
            archiveSection={{name: 'Backups'}}
            leftInset={SIDEBAR}
            onClose={f.closeSettings}
            onArchiveEverything={f.archiveEverything}
            onRestore={f.pickArchive}
          />
        )}
        {f.restoring && (
          <Modal onClose={f.closeRestore} width={620}>
            <h2 className="mb-2 text-base font-semibold text-zinc-900">
              What’s in this Archive
            </h2>
            <RestoreBody
              archive={f.restoring}
              onRestore={f.restored}
              onCancel={f.closeRestore}
              layout="compare"
            />
          </Modal>
        )}
        {f.dropping && <DropOverlay />}
        <KnobsPanel onDrop={f.restoreFrom} onOpenFile={f.pickArchive} />
      </Shell>
    </GhostContext.Provider>
  )
}

function TakeDialog({
  take,
  f,
  onPick,
  onClose,
}: {
  take: Take
  f: Flows
  onPick: (p: Take['pick']) => void
  onClose: () => void
}) {
  const thread = take.scope.kind === 'thread'
  const cards = [
    {
      k: 'export',
      icon: '📄',
      title: 'Readable copy',
      sub: 'Markdown you can open anywhere, print or share. Can’t be restored.',
    },
    {
      k: 'summary',
      icon: '✦',
      title: 'AI summary',
      sub: 'The gist, written by a Model you pick. Made outside the Tree.',
    },
    ...(thread
      ? []
      : [
          {
            k: 'archive',
            icon: '📦',
            title: 'Full backup (Archive)',
            sub: 'Everything, files and history included. Restore it later.',
          },
        ]),
  ] as const
  return (
    <Modal onClose={onClose} width={take.pick ? 540 : 620}>
      <div className="mb-3 flex items-center gap-2">
        {take.pick && (
          <button
            onClick={() => onPick(null)}
            className="text-zinc-400 hover:text-zinc-900"
          >
            ←
          </button>
        )}
        <h2 className="text-base font-semibold text-zinc-900">
          {thread
            ? 'Take a copy of this Thread'
            : `Take a copy of “${f.title}”`}
        </h2>
      </div>
      {!take.pick && (
        <div className={`grid gap-3 ${thread ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {cards.map(c => (
            <button
              key={c.k}
              onClick={() => {
                if (c.k === 'summary') {
                  onClose()
                  if (take.scope.kind === 'thread')
                    f.summarizeThread(take.scope.replyId)
                  else f.summarizeTree()
                } else onPick(c.k as Take['pick'])
              }}
              className="flex flex-col items-start gap-1 rounded-xl border border-zinc-200 p-4 text-left hover:border-violet-400 hover:bg-violet-50"
            >
              <span className="text-2xl">{c.icon}</span>
              <span className="text-sm font-medium text-zinc-900">
                {c.title}
              </span>
              <span className="text-xs text-zinc-500">{c.sub}</span>
            </button>
          ))}
        </div>
      )}
      {take.pick === 'export' && (
        <ExportBody
          target={
            take.scope.kind === 'thread'
              ? {
                  kind: 'thread',
                  treeKey: f.treeKey,
                  replyId: take.scope.replyId,
                  title: f.title,
                }
              : {kind: 'tree', treeKey: f.treeKey, title: f.title}
          }
          onDone={onClose}
        />
      )}
      {take.pick === 'archive' && (
        <ArchiveBody
          target={{kind: 'tree', treeKey: f.treeKey, title: f.title}}
          onDone={onClose}
        />
      )}
    </Modal>
  )
}

function GhostCard(_: NodeProps) {
  const f = useContext(GhostContext)
  if (!f?.summary) return null
  return (
    <div className="nodrag nowheel w-[420px] rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/70 shadow-sm">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="text-violet-600">✦</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
          {summaryTitle(f.summary)}
        </span>
      </div>
      <div className="px-4 text-[11px] text-violet-700">
        Not part of the Tree · the AI never sees this
      </div>
      {f.run ? (
        <>
          <div className="max-h-80 overflow-y-auto px-4 py-3">
            <SummaryProgress run={f.run} />
            <SummaryText run={f.run} />
          </div>
          <div className="border-t border-violet-200 px-4 py-2.5">
            <SummaryActions run={f.run} onClose={f.closeSummary} />
          </div>
        </>
      ) : (
        <div className="px-4 py-3">
          <SummaryOptions
            target={f.summary}
            model={f.model}
            onModel={f.setModel}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={f.closeSummary}>Cancel</Btn>
            <Btn primary onClick={f.startSummary}>
              Summarize
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function Palette({
  actions,
  onClose,
}: {
  actions: {label: string; run: () => void}[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = actions.filter(a =>
    a.label.toLowerCase().includes(q.toLowerCase())
  )
  const go = (a?: {run: () => void}) => {
    if (!a) return
    onClose()
    a.run()
  }
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/20 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[520px] overflow-hidden rounded-xl bg-white shadow-2xl"
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
            if (e.key === 'ArrowDown')
              setI(n => Math.min(n + 1, list.length - 1))
            if (e.key === 'ArrowUp') setI(n => Math.max(n - 1, 0))
            if (e.key === 'Enter') go(list[i])
          }}
          placeholder="Summarize, export, archive, restore…"
          className="w-full border-b border-zinc-200 px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {list.map((a, n) => (
            <button
              key={a.label}
              onMouseEnter={() => setI(n)}
              onClick={() => go(a)}
              className={`block w-full px-4 py-2 text-left text-sm ${n === i ? 'bg-violet-50 text-violet-900' : 'text-zinc-700'}`}
            >
              {a.label}
            </button>
          ))}
          {!list.length && (
            <div className="px-4 py-3 text-sm text-zinc-400">
              Nothing matches
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
