import type {Decor} from '../canvas-mode-ux/shared'
import type {Turn} from '../canvas-mode-ux/tree'
import type {Nav} from './main'

// PROTOTYPE variant B: toolbars and sheets. A Tree bar above the canvas holds the Tree's actions; Replies get a hover
// pill; Export and Archive share one "Save a copy" sheet; the Summary docks along the bottom of the canvas with its
// setup inline; restore takes over the window; Archive lives inside Settings → Storage. Throw away.
import {useMemo, useRef, useState} from 'react'

import {
  ArchiveBody,
  Btn,
  DropOverlay,
  ExportBody,
  KnobsPanel,
  RestoreBody,
  SettingsPage,
  SummaryActions,
  SummaryOptions,
  SummaryProgress,
  summaryTitle,
  SummaryText,
} from './common'
import {useFlows, type Flows} from './flows'
import {SIDEBAR, Shell} from './layout'

export const name = 'Toolbars and sheets'

type Sheet = {scope: 'thread'; replyId: string} | {scope: 'tree'} | null

export function VariantB({nav}: {nav: Nav}) {
  const f = useFlows(nav)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [tab, setTab] = useState<'export' | 'archive'>('export')
  const live = useRef({f, open: (s: Sheet) => setSheet(s)})
  live.current = {f, open: setSheet}
  const decor = useMemo<Partial<Decor>>(
    () => ({
      replyOverlay: r => <ReplyPill reply={r} live={live} />,
      replyFooter: (r, where) =>
        where === 'drawer' ? <DrawerLinks reply={r} live={live} /> : null,
    }),
    []
  )
  const has = f.hasTurns()

  const bar = (
    <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
        {f.title}
      </span>
      <button
        disabled={!has}
        onClick={() => f.summarizeTree()}
        className="rounded-lg px-2.5 py-1 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-40"
      >
        ✦ Summarize
      </button>
      <button
        disabled={!has}
        onClick={() => {
          setTab('export')
          setSheet({scope: 'tree'})
        }}
        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
      >
        ⤓ Save a copy
      </button>
    </div>
  )

  return (
    <Shell nav={nav} decor={decor} onGear={f.openSettings} canvasTop={bar}>
      {f.settings && (
        <SettingsPage
          archiveSection="storage"
          leftInset={SIDEBAR}
          onClose={f.closeSettings}
          onArchiveEverything={f.archiveEverything}
          onRestore={f.pickArchive}
        />
      )}
      {sheet && (
        <SaveSheet
          sheet={sheet}
          tab={tab}
          onTab={setTab}
          f={f}
          onClose={() => setSheet(null)}
        />
      )}
      {/* Archive everything, from Settings, reuses the sheet's Archive body. */}
      {f.archiving?.kind === 'everything' && (
        <SideSheet title="Archive everything" onClose={f.closeArchive}>
          <ArchiveBody target={f.archiving} onDone={f.closeArchive} />
        </SideSheet>
      )}
      {f.restoring && (
        <div className="fixed inset-0 z-[66] overflow-y-auto bg-zinc-50">
          <div className="mx-auto max-w-xl px-6 py-10">
            <button
              onClick={f.closeRestore}
              className="mb-4 text-sm text-zinc-500 hover:text-zinc-900"
            >
              ← Back
            </button>
            <h1 className="text-xl font-semibold text-zinc-900">
              Restore from Archive
            </h1>
            <p className="mt-1 mb-2 text-sm text-zinc-600">
              Nothing changes until you press Restore.
            </p>
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <RestoreBody
                archive={f.restoring}
                onRestore={f.restored}
                onCancel={f.closeRestore}
              />
            </div>
          </div>
        </div>
      )}
      {f.summary && <SummaryDock f={f} />}
      {f.dropping && <DropOverlay />}
      <KnobsPanel onDrop={f.restoreFrom} onOpenFile={f.pickArchive} />
    </Shell>
  )
}

type Live = {current: {f: Flows; open: (s: Sheet) => void}}

function ReplyPill({reply, live}: {reply: Turn; live: Live}) {
  if (reply.status === 'streaming' || reply.status === 'failed') return null
  const {f, open} = live.current
  const b = 'rounded-full px-2 py-0.5 hover:bg-zinc-100'
  return (
    <div className="nodrag absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-full border border-zinc-200 bg-white px-1 text-[11px] whitespace-nowrap text-zinc-600 shadow-sm group-hover:flex">
      <button
        className={`${b} text-violet-700`}
        onClick={() => live.current.f.summarizeThread(reply.id)}
        title="Summarize the Thread up to this Reply"
      >
        ✦ Summarize up to here
      </button>
      <button
        className={b}
        onClick={() => open({scope: 'thread', replyId: reply.id})}
        title="Export this Thread"
      >
        ⤓ Export
      </button>
      <button
        className={b}
        onClick={() => f.copyThread(reply.id)}
        title="Copy this Thread as Markdown"
      >
        ⧉ Copy
      </button>
    </div>
  )
}

function DrawerLinks({reply, live}: {reply: Turn; live: Live}) {
  if (reply.status === 'streaming' || reply.status === 'failed') return null
  const {f, open} = live.current
  return (
    <span className="ml-auto flex gap-2">
      <button
        onClick={() => f.summarizeThread(reply.id)}
        className="text-violet-700 hover:underline"
      >
        Summarize up to here
      </button>
      <button
        onClick={() => open({scope: 'thread', replyId: reply.id})}
        className="hover:text-zinc-900 hover:underline"
      >
        Export
      </button>
      <button
        onClick={() => f.copyThread(reply.id)}
        className="hover:text-zinc-900 hover:underline"
      >
        Copy
      </button>
    </span>
  )
}

function SideSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[65] bg-black/20" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 flex w-[480px] flex-col bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <span className="text-base font-semibold text-zinc-900">{title}</span>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function SaveSheet({
  sheet,
  tab,
  onTab,
  f,
  onClose,
}: {
  sheet: NonNullable<Sheet>
  tab: 'export' | 'archive'
  onTab: (t: 'export' | 'archive') => void
  f: Flows
  onClose: () => void
}) {
  // A Thread can only be exported; Archive is always the whole Tree.
  const t = sheet.scope === 'thread' ? 'export' : tab
  return (
    <SideSheet
      title={
        sheet.scope === 'thread'
          ? 'Save this Thread'
          : `Save a copy of “${f.title}”`
      }
      onClose={onClose}
    >
      {sheet.scope === 'tree' && (
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
          {(
            [
              ['export', 'Readable (Markdown)'],
              ['archive', 'Archive (full backup)'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => onTab(k)}
              className={`rounded-md py-1 ${t === k ? 'bg-white font-medium text-zinc-900 shadow-sm' : 'text-zinc-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {t === 'export' ? (
        <ExportBody
          target={
            sheet.scope === 'thread'
              ? {
                  kind: 'thread',
                  treeKey: f.treeKey,
                  replyId: sheet.replyId,
                  title: f.title,
                }
              : {kind: 'tree', treeKey: f.treeKey, title: f.title}
          }
          onDone={onClose}
        />
      ) : (
        <ArchiveBody
          target={{kind: 'tree', treeKey: f.treeKey, title: f.title}}
          onDone={onClose}
        />
      )}
    </SideSheet>
  )
}

function SummaryDock({f}: {f: Flows}) {
  const target = f.summary!
  return (
    <div
      style={{left: SIDEBAR}}
      className="fixed right-0 bottom-0 z-[47] flex h-[42vh] flex-col border-t-2 border-violet-300 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-2">
        <span className="text-violet-600">✦</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
          {summaryTitle(target)}
        </span>
        <span className="text-[11px] text-zinc-400">Not part of the Tree</span>
        {!f.run && (
          <button
            onClick={f.closeSummary}
            className="ml-2 text-zinc-400 hover:text-zinc-900"
          >
            ✕
          </button>
        )}
      </div>
      {f.run ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <div className="mx-auto max-w-3xl">
              <SummaryProgress run={f.run} />
              <SummaryText run={f.run} />
            </div>
          </div>
          <div className="border-t border-zinc-100 px-5 py-2">
            <div className="mx-auto max-w-3xl">
              <SummaryActions run={f.run} onClose={f.closeSummary} />
            </div>
          </div>
        </>
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-5">
          <SummaryOptions
            target={target}
            model={f.model}
            onModel={f.setModel}
          />
          <div className="flex justify-end gap-2">
            <Btn onClick={f.closeSummary}>Cancel</Btn>
            <Btn primary onClick={f.startSummary}>
              ✦ Summarize
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
