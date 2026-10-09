import type {TreeEntry} from '../workspace-file-tree/workspace'
import type {Nav} from './main'

// PROTOTYPE: the app around the variants: Workspace file tree variant A (sidebar with Trees above, files below; canvas;
// chat slideout). Variants add their entry points through slots. Throw away.
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import {
  DecorContext,
  useSim,
  type Decor,
  type HostApi,
} from '../canvas-mode-ux/shared'
import {simCache} from '../canvas-mode-ux/tree'
import {VariantD} from '../canvas-mode-ux/VariantD'
import {FileChips, FilePreview, UserEdits} from '../workspace-file-tree/common'
import {FilesPanel} from '../workspace-file-tree/VariantA'

export const SIDEBAR = 290

export const titleOf = (e: TreeEntry) => {
  const s = simCache.get(e.key)
  const root = s && Object.values(s.tree).find(t => !t.parentId)
  return e.title === 'New Tree' ? root?.text.split('\n')[0] || e.title : e.title
}

export function Shell({
  nav,
  decor: extra,
  rowExtra,
  sidebarFooter,
  onGear,
  canvasTop,
  onDrawerReply,
  hostRef,
  children,
}: {
  nav: Nav
  decor?: Partial<Decor>
  rowExtra?: (e: TreeEntry, active: boolean) => ReactNode
  sidebarFooter?: ReactNode
  onGear: () => void
  canvasTop?: ReactNode
  onDrawerReply?: (id: string | null) => void
  hostRef?: React.RefObject<HostApi | null>
  children?: ReactNode
}) {
  const sim = useSim()
  const ownHost = useRef<HostApi | null>(null)
  const host = hostRef ?? ownHost
  const [drawerReply, setDrawerReply] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    path: string
    turnId: string | null
  } | null>(null)
  const focus = drawerReply ?? sim.activeReplyId
  useSyncExternalStore(simCache.subscribe, simCache.version)

  const decor = useMemo<Decor>(
    () => ({
      hostApi: host,
      leftInset: SIDEBAR,
      replyBottom: (r, where) =>
        where === 'canvas' ? (
          <FileChips
            reply={r}
            onOpen={path => setPreview({path, turnId: r.id})}
          />
        ) : null,
      prompt: p => <UserEdits prompt={p} />,
      ...extra,
      onFocusReply: id => {
        setDrawerReply(id)
        onDrawerReply?.(id)
      },
    }),
    [extra, host, onDrawerReply]
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
              onClick={onGear}
              className="text-zinc-400 hover:text-zinc-900"
            >
              ⚙
            </button>
          </div>
          <div className="max-h-[38%] overflow-y-auto px-2">
            <button
              onClick={nav.onNew}
              className="mb-1 w-full rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50"
            >
              ＋ New Tree
            </button>
            {nav.entries.map(e => {
              const s = simCache.get(e.key)
              const active = e.key === nav.current
              return (
                <div
                  key={e.key}
                  data-tree={e.key}
                  className={`group/row relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
                >
                  <button
                    onClick={() => nav.onPick(e.key)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="text-xs">
                      {!s?.workspace
                        ? '💬'
                        : s.workspace.kind === 'app'
                          ? '🗂'
                          : '🔗'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {titleOf(e)}
                    </span>
                  </button>
                  {rowExtra?.(e, active)}
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-zinc-200">
            <FilesPanel
              focus={focus}
              following={!drawerReply}
              onBackToLatest={() => host.current?.select(null)}
              onOpen={path => setPreview({path, turnId: null})}
              selected={preview?.turnId === null ? preview.path : null}
              onAdd={() => {}}
            />
          </div>
          {sidebarFooter}
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          {canvasTop}
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
      {children}
    </DecorContext.Provider>
  )
}
