// PROTOTYPE: ⌘K search palette (#44). Variants switchable via ?variant=A|B|C, hosted on the Reconnect, offline and
// error states prototype's app (its variant A, the winner). The palette renders outside the Tree view so it survives
// switching Trees (variant C previews live). Throw away.
import './seed'

import {ReactFlowProvider} from '@xyflow/react'
import {useEffect, useMemo, useState, type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
  UsageUiContext,
  type Decor,
} from '../canvas-mode-ux/shared'
import {useTreeSim, type SimState} from '../canvas-mode-ux/tree'
import {ReconnectDialog, SettingsModal} from '../error-states/common'
import {useUi} from '../error-states/VariantA'
import {ExtraDecorContext, useLibrary, type Lib} from '../tree-sidebar/common'
import {PaletteContext, VariantB as Sidebar} from '../tree-sidebar/VariantB'
import {ToastProvider} from '../workspace-file-tree/common'
import {planFiles} from '../workspace-file-tree/workspace'
import {marksStore, MarkedText} from './common'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'

type PaletteProps = {lib: Lib; onClose: () => void}
const VARIANTS: {
  key: string
  name: string
  Palette: ComponentType<PaletteProps>
  Overlay?: ComponentType<{lib: Lib; reopen: () => void}>
}[] = [
  {key: 'A', name: A.name, Palette: A.Palette},
  {key: 'B', name: B.name, Palette: B.Palette, Overlay: B.Overlay},
  {key: 'C', name: C.name, Palette: C.Palette},
]

// Size watchers run on the next frame, so a callback that changes layout can't re-trigger itself in the same frame.
const NativeResizeObserver = window.ResizeObserver
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) =>
      requestAnimationFrame(() => callback(entries, observer))
    )
  }
}
window.addEventListener(
  'error',
  e => {
    if (e.message?.includes('ResizeObserver')) e.stopImmediatePropagation()
  },
  {capture: true}
)

function App() {
  const [variant, setVariant] = useState(
    () => new URLSearchParams(location.search).get('variant') ?? 'A'
  )
  const [open, setOpen] = useState(false)
  const lib = useLibrary()
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
    setOpen(false)
    marksStore.set(null)
  }
  const v = VARIANTS.find(x => x.key === variant) ?? VARIANTS[0]!
  const entry = lib.entries.find(e => e.key === lib.current)!
  const palette = useMemo(() => ({toggle: () => setOpen(o => !o)}), [])

  // Marks from A and C go away with Esc once the palette is closed (B's find bar handles its own).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !open && !v.Overlay) marksStore.set(null)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, v])

  return (
    <ToastProvider>
      <PaletteContext.Provider value={palette}>
        <Ui>
          <TreeView
            key={entry.key}
            entryKey={entry.key}
            init={entry.init}
            lib={lib}
          />
          {v.Overlay && <v.Overlay lib={lib} reopen={() => setOpen(true)} />}
        </Ui>
      </PaletteContext.Provider>
      {open && (
        <v.Palette key={v.key} lib={lib} onClose={() => setOpen(false)} />
      )}
      <SettingsModal />
      <ReconnectDialog />
      <QuestionNote />
      {process.env.NODE_ENV !== 'production' && (
        <PrototypeSwitcher
          variants={VARIANTS}
          current={v.key}
          onChange={change}
        />
      )}
    </ToastProvider>
  )
}

function Ui({children}: {children: React.ReactNode}) {
  return (
    <UsageUiContext.Provider value={useUi()}>
      {children}
    </UsageUiContext.Provider>
  )
}

function TreeView({
  entryKey,
  init,
  lib,
}: {
  entryKey: string
  init: () => SimState
  lib: Lib
}) {
  const sim = useTreeSim({key: entryKey, init, planFiles})
  const decor = useMemo<Decor>(
    () => ({
      promptBody: (t, where) => (
        <MarkedText treeKey={entryKey} turn={t} where={where} />
      ),
      replyBody: (t, where) => (
        <MarkedText treeKey={entryKey} turn={t} where={where} />
      ),
    }),
    [entryKey]
  )
  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider>
        <ReactFlowProvider>
          <ExtraDecorContext.Provider value={decor}>
            <Sidebar lib={lib} />
          </ExtraDecorContext.Provider>
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

function QuestionNote() {
  const [shown, setShown] = useState(true)
  if (!shown)
    return (
      <button
        onClick={() => setShown(true)}
        className="fixed right-3 bottom-3 z-[70] rounded-full border border-fuchsia-300 bg-fuchsia-50 px-2 py-1 text-[11px] text-fuchsia-800"
      >
        ?
      </button>
    )
  return (
    <div className="fixed right-3 bottom-3 z-[70] w-72 rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-3 text-[11px] leading-relaxed text-fuchsia-900 shadow">
      <div className="mb-1 flex font-semibold">
        PROTOTYPE · ⌘K search (#44)
        <button
          onClick={() => setShown(false)}
          className="ml-auto opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      </div>
      <p>
        What should the palette feel like: empty state, ranking and grouping,
        filters, snippets, keyboard flow, and what opening a result does on the
        canvas?
      </p>
      <p className="mt-1.5">
        Press <b>⌘K</b> or “Search all Trees”. Try <i>pizza</i>, <i>budget</i>,{' '}
        <i>pgbouncer</i>, <i>dragon</i>, <i>sleep</i>, <i>cafe</i> (finds café),{' '}
        <i>pgbounc pause</i> (both words), <i>dough</i> (an attachment), or a
        2-letter query.
      </p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
