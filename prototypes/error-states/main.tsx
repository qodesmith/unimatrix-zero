// PROTOTYPE: Reconnect, offline and error states (#40). Variants switchable via ?variant=A|B|C, hosted on the Usage
// display prototype's app (its variant D, the winner). Health and usage stores are app-wide and survive switching
// variants and Trees. Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useState} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
  UsageUiContext,
  type UsageUi,
} from '../canvas-mode-ux/shared'
import {useTreeSim, type SimState} from '../canvas-mode-ux/tree'
import {useLibrary, type Lib} from '../tree-sidebar/common'
import {VariantB as Sidebar} from '../tree-sidebar/VariantB'
import {ToastProvider} from '../workspace-file-tree/common'
import {planFiles} from '../workspace-file-tree/workspace'
import {HealthDebug, ReconnectDialog, SettingsModal} from './common'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'

const VARIANTS = [
  {key: 'A', name: A.name, useUi: A.useUi},
  {key: 'B', name: B.name, useUi: B.useUi},
  {key: 'C', name: C.name, useUi: C.useUi},
]

const QUESTION =
  'When sign-in, the network, a vendor program, the vendor or an update goes wrong, where does the user see it, what does it say, and what one thing can they do?'

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
      <Ui key={v.key} useUi={v.useUi}>
        <TreeView
          key={entry.key}
          entryKey={entry.key}
          init={entry.init}
          lib={lib}
        />
      </Ui>
      <SettingsModal />
      <ReconnectDialog />
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

function Ui({
  useUi,
  children,
}: {
  useUi: () => UsageUi
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
          <HealthDebug question={QUESTION} />
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
