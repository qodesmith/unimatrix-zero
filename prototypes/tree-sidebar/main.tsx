// PROTOTYPE: Tree sidebar (organizing, searching, renaming, deleting), variants switchable via ?variant=A|B|C, hosted on
// the Export, Archive and Summary prototype's app. Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useState, type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
} from '../canvas-mode-ux/shared'
import {useTreeSim} from '../canvas-mode-ux/tree'
import {ToastProvider} from '../workspace-file-tree/common'
import {planFiles} from '../workspace-file-tree/workspace'
import {useLibrary, type Lib} from './common'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'

const VARIANTS: {
  key: string
  name: string
  Component: ComponentType<{lib: Lib}>
}[] = [
  {key: 'A', name: A.name, Component: A.VariantA},
  {key: 'B', name: B.name, Component: B.VariantB},
  {key: 'C', name: C.name, Component: C.VariantC},
]

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
      <TreeView
        key={`${entry.key}-${v.key}`}
        entryKey={entry.key}
        init={entry.init}
        Variant={v.Component}
        lib={lib}
      />
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

function TreeView({
  entryKey,
  init,
  Variant,
  lib,
}: {
  entryKey: string
  init: () => import('../canvas-mode-ux/tree').SimState
  Variant: ComponentType<{lib: Lib}>
  lib: Lib
}) {
  const sim = useTreeSim({key: entryKey, init, planFiles})
  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider>
        <ReactFlowProvider>
          <Variant lib={lib} />
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
