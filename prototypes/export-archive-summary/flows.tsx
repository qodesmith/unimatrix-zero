import type {Nav} from './main'

// PROTOTYPE: the open/closed state every variant needs; variants differ in where these are reached and how they're shown.
import {useCallback, useEffect, useState} from 'react'

import {useSim} from '../canvas-mode-ux/shared'
import {simCache} from '../canvas-mode-ux/tree'
import {useToast} from '../workspace-file-tree/common'
import {
  ARCHIVES,
  DEFAULT_SUMMARY_MODEL,
  threadMarkdown,
  useArchiveDrop,
  useEscStops,
  useSummaryRun,
  type ArchiveTarget,
  type ExportTarget,
  type FakeArchive,
  type SummaryTarget,
} from './common'
import {titleOf} from './layout'

export function useFlows(nav: Nav) {
  const sim = useSim()
  const toast = useToast()
  const [exporting, setExporting] = useState<ExportTarget | null>(null)
  const [archiving, setArchiving] = useState<ArchiveTarget | null>(null)
  const [restoring, setRestoring] = useState<FakeArchive | null>(null)
  const [settings, setSettings] = useState(false)
  const [summary, setSummary] = useState<SummaryTarget | null>(null)
  const [model, setModel] = useState(DEFAULT_SUMMARY_MODEL)
  const [started, setStarted] = useState(false)
  const run = useSummaryRun(summary, model, started)
  useEscStops(run)
  const dropping = useArchiveDrop(
    useCallback(() => setRestoring(ARCHIVES.everything), [])
  )

  useEffect(() => {
    if (!settings) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettings(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings])

  const entry = nav.entries.find(e => e.key === nav.current)!
  const title = titleOf(entry)
  const treeKey = nav.current

  return {
    title,
    treeKey,
    exporting,
    archiving,
    restoring,
    settings,
    summary,
    model,
    started,
    run,
    dropping,
    setModel,
    closeExport: () => setExporting(null),
    closeArchive: () => setArchiving(null),
    closeRestore: () => setRestoring(null),
    restored: (titles: string[]) => {
      setRestoring(null)
      nav.onRestored(titles)
    },
    openSettings: () => setSettings(true),
    closeSettings: () => setSettings(false),
    exportThread: (replyId: string) =>
      setExporting({kind: 'thread', treeKey, replyId, title}),
    exportTree: (key = treeKey) =>
      setExporting({
        kind: 'tree',
        treeKey: key,
        title: titleOf(nav.entries.find(e => e.key === key)!),
      }),
    copyThread: (replyId: string) => {
      void navigator.clipboard
        ?.writeText(threadMarkdown(sim.tree, replyId, title))
        .catch(() => {})
      toast('Thread copied as Markdown')
    },
    archiveTree: (key = treeKey) =>
      setArchiving({
        kind: 'tree',
        treeKey: key,
        title: titleOf(nav.entries.find(e => e.key === key)!),
      }),
    archiveEverything: () =>
      setArchiving({kind: 'everything', keys: nav.entries.map(e => e.key)}),
    restoreFrom: (a: keyof typeof ARCHIVES) => setRestoring(ARCHIVES[a]),
    // Restore… opens a file picker first; the prototype picks the big Archive.
    pickArchive: () => setRestoring(ARCHIVES.everything),
    summarizeThread: (replyId: string) => {
      setSummary({kind: 'thread', treeKey, replyId, title})
      setModel(sim.tree[replyId]?.model ?? DEFAULT_SUMMARY_MODEL)
      setStarted(false)
    },
    summarizeTree: (key = treeKey) => {
      setSummary({
        kind: 'tree',
        treeKey: key,
        title: titleOf(nav.entries.find(e => e.key === key)!),
      })
      setModel(DEFAULT_SUMMARY_MODEL)
      setStarted(false)
    },
    startSummary: () => setStarted(true),
    closeSummary: () => {
      setSummary(null)
      setStarted(false)
    },
    hasTurns: (key = treeKey) =>
      Object.keys(simCache.get(key)?.tree ?? {}).length > 0,
  }
}

export type Flows = ReturnType<typeof useFlows>
