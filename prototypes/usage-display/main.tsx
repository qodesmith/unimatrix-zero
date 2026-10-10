// PROTOTYPE: Usage and limit display (#36). Variants switchable via ?variant=A|B|C|D (D combines A and B, the pick), hosted on the Tree sidebar
// prototype's app (its variant B, the winner). The usage store is account-wide and survives switching variants and
// Trees. Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useState} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
  UsageUiContext,
} from '../canvas-mode-ux/shared'
import {useTreeSim, type SimState} from '../canvas-mode-ux/tree'
import {useLibrary, type Lib} from '../tree-sidebar/common'
import {VariantB as Sidebar} from '../tree-sidebar/VariantB'
import {ToastProvider} from '../workspace-file-tree/common'
import {planFiles} from '../workspace-file-tree/workspace'
import {SettingsModal, UsageDebug} from './common'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'
import * as D from './VariantD'

const VARIANTS = [
  {key: 'A', name: A.name, useUi: A.useUi},
  {key: 'B', name: B.name, useUi: B.useUi},
  {key: 'C', name: C.name, useUi: C.useUi},
  {key: 'D', name: D.name, useUi: D.useUi},
]

const QUESTION =
  'Where does usage live, which windows show, what does "limit reached" look like, and what happens to concurrent Threads?'

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
  const lib = useLibrary()
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }
  const v = VARIANTS.find(x => x.key === variant) ?? VARIANTS[0]!
  const entry = lib.entries.find(e => e.key === lib.current)!
  return (
    <ToastProvider>
      <Usage key={v.key} useUi={v.useUi}>
        <TreeView
          key={entry.key}
          entryKey={entry.key}
          init={entry.init}
          lib={lib}
        />
      </Usage>
      <SettingsModal />
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

function Usage({
  useUi,
  children,
}: {
  useUi: () => import('../canvas-mode-ux/shared').UsageUi
  children: React.ReactNode
}) {
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
  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider>
        <ReactFlowProvider>
          <Sidebar lib={lib} />
          <UsageDebug question={QUESTION} />
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
