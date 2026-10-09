import type {Decor} from '../canvas-mode-ux/shared'
import type {Turn} from '../canvas-mode-ux/tree'
import type {Nav} from './main'

// PROTOTYPE variant A: menus. A ⋯ menu on every Tree row and every Reply (canvas and chat slideout), modal dialogs, a
// Summary that floats bottom-right without blocking anything, and Archive & restore as its own Settings section. Throw away.
import {useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'

import {
  ArchiveDialog,
  Btn,
  DropOverlay,
  ExportDialog,
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

export const name = 'Menus and dialogs'

export function VariantA({nav}: {nav: Nav}) {
  const f = useFlows(nav)
  // Decor stays stable so the canvas doesn't churn; menus read the latest flows through the ref.
  const live = useRef(f)
  live.current = f
  const decor = useMemo<Partial<Decor>>(
    () => ({
      replyFooter: (r, where) => (
        <ReplyMenu reply={r} where={where} live={live} />
      ),
    }),
    []
  )
  return (
    <Shell
      nav={nav}
      decor={decor}
      onGear={f.openSettings}
      rowExtra={(e, active) => (
        <TreeMenu treeKey={e.key} active={active} f={f} />
      )}
    >
      {f.settings && (
        <SettingsPage
          archiveSection={{name: 'Archive & restore'}}
          leftInset={SIDEBAR}
          onClose={f.closeSettings}
          onArchiveEverything={f.archiveEverything}
          onRestore={f.pickArchive}
        />
      )}
      {f.exporting && (
        <ExportDialog target={f.exporting} onClose={f.closeExport} />
      )}
      {f.archiving && (
        <ArchiveDialog target={f.archiving} onClose={f.closeArchive} />
      )}
      {f.restoring && (
        <Modal onClose={f.closeRestore} width={540}>
          <h2 className="mb-2 text-base font-semibold text-zinc-900">
            Restore from Archive
          </h2>
          <RestoreBody
            archive={f.restoring}
            onRestore={f.restored}
            onCancel={f.closeRestore}
          />
        </Modal>
      )}
      {f.summary && !f.started && (
        <Modal onClose={f.closeSummary} width={440}>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">
            {f.summary.kind === 'tree'
              ? 'Summarize this Tree'
              : 'Summarize up to here'}
          </h2>
          <SummaryOptions
            target={f.summary}
            model={f.model}
            onModel={f.setModel}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Btn onClick={f.closeSummary}>Cancel</Btn>
            <Btn primary onClick={f.startSummary}>
              Summarize
            </Btn>
          </div>
        </Modal>
      )}
      {f.run && (
        <div className="fixed right-4 bottom-16 z-[48] flex max-h-[70vh] w-[420px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
            <span className="text-violet-600">✦</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
              {summaryTitle(f.run.target)}
            </span>
            <span className="text-[11px] text-zinc-400">{f.run.model}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <SummaryProgress run={f.run} />
            <SummaryText run={f.run} />
          </div>
          <div className="border-t border-zinc-100 px-4 py-2.5">
            <SummaryActions run={f.run} onClose={f.closeSummary} />
          </div>
        </div>
      )}
      {f.dropping && <DropOverlay />}
      <KnobsPanel onDrop={f.restoreFrom} onOpenFile={f.pickArchive} />
    </Shell>
  )
}

function TreeMenu({
  treeKey,
  active,
  f,
}: {
  treeKey: string
  active: boolean
  f: Flows
}) {
  // Fixed at the button's screen position, so the menu floats over everything instead of scrolling the Tree list.
  const [open, setOpen] = useState<DOMRect | null>(null)
  const has = f.hasTurns(treeKey)
  const items: MenuItem[] = [
    {label: 'Rename', onClick: () => {}, disabled: true},
    {label: 'Storage…', onClick: () => {}, disabled: true},
    'sep',
    {
      label: 'Summarize this Tree…',
      onClick: () => f.summarizeTree(treeKey),
      disabled: !has,
    },
    {
      label: 'Export Tree…',
      hint: 'Markdown',
      onClick: () => f.exportTree(treeKey),
      disabled: !has,
    },
    {label: 'Archive…', onClick: () => f.archiveTree(treeKey), disabled: !has},
    'sep',
    {label: 'Delete…', danger: true, onClick: () => {}, disabled: true},
  ]
  return (
    <>
      <button
        onClick={e => {
          const r = (
            e.currentTarget.closest('[data-tree]') ?? e.currentTarget
          ).getBoundingClientRect()
          setOpen(o => (o ? null : r))
        }}
        className={`px-1 ${open ? 'block' : 'hidden group-hover/row:block'} ${active ? 'text-zinc-300 hover:text-white' : 'text-zinc-400 hover:text-zinc-900'}`}
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
              top: open.bottom + 4,
              left: open.right - 208,
            }}
            className="text-zinc-800"
          />,
          document.body
        )}
    </>
  )
}

function ReplyMenu({
  reply,
  where,
  live,
}: {
  reply: Turn
  where: 'canvas' | 'drawer'
  live: {current: Flows}
}) {
  const [open, setOpen] = useState(false)
  const f = live.current
  if (reply.status === 'streaming' || reply.status === 'failed') return null
  const items: MenuItem[] = [
    {
      label: 'Summarize up to here…',
      onClick: () => f.summarizeThread(reply.id),
    },
    'sep',
    {label: 'Export Thread…', onClick: () => f.exportThread(reply.id)},
    {label: 'Copy as Markdown', onClick: () => f.copyThread(reply.id)},
  ]
  return (
    <span className={`nodrag relative ${where === 'canvas' ? 'ml-auto' : ''}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
        title="More"
      >
        ⋯
      </button>
      {open && (
        <Menu
          items={items}
          onClose={() => setOpen(false)}
          className="absolute right-0 bottom-full mb-1"
        />
      )}
    </span>
  )
}
