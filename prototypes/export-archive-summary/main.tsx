// PROTOTYPE: Export, Archive and Summary entry points, variants switchable via ?variant=A|B|C, hosted on Workspace file
// tree variant A. Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useState, type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
} from '../canvas-mode-ux/shared'
import {emptySim, simCache, useTreeSim} from '../canvas-mode-ux/tree'
import {ToastProvider} from '../workspace-file-tree/common'
import {
  newTreeEntry,
  planFiles,
  seedPlainKyoto,
  TREES,
  type TreeEntry,
} from '../workspace-file-tree/workspace'
import {KnobsContext, type Knobs} from './common'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'

export type Nav = {
  entries: TreeEntry[]
  current: string
  onPick: (key: string) => void
  onNew: () => void
  // Restore adds new Trees.
  onRestored: (titles: string[]) => void
}

const VARIANTS: {
  key: string
  name: string
  Component: ComponentType<{nav: Nav}>
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

for (const t of TREES) simCache.set(t.key, t.init())

let restoredSeq = 0

function App() {
  const [variant, setVariant] = useState(
    () => new URLSearchParams(location.search).get('variant') ?? 'A'
  )
  const [entries, setEntries] = useState(TREES)
  const [current, setCurrent] = useState(TREES[0]!.key)
  const [knobs, setKnobs] = useState<Knobs>({freeBytes: 212e9, hugeTree: false})
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }
  const nav: Nav = {
    entries,
    current,
    onPick: setCurrent,
    onNew: () => {
      const e = newTreeEntry(entries.length)
      simCache.set(e.key, emptySim())
      setEntries(list => [e, ...list])
      setCurrent(e.key)
    },
    onRestored: titles => {
      const fresh = titles
        .filter(t => !entries.some(e => e.title === t))
        .map(title => ({
          key: `restored-${++restoredSeq}`,
          init: seedPlainKyoto,
          title,
        }))
      for (const e of fresh) simCache.set(e.key, e.init())
      setEntries(list => [...fresh, ...list])
    },
  }
  const v = VARIANTS.find(x => x.key === variant) ?? VARIANTS[0]!
  return (
    <ToastProvider>
      <KnobsContext.Provider value={{knobs, setKnobs}}>
        <TreeView
          key={`${current}-${v.key}`}
          entry={entries.find(e => e.key === current)!}
          Variant={v.Component}
          nav={nav}
        />
      </KnobsContext.Provider>
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
  entry,
  Variant,
  nav,
}: {
  entry: TreeEntry
  Variant: ComponentType<{nav: Nav}>
  nav: Nav
}) {
  const sim = useTreeSim({key: entry.key, init: entry.init, planFiles})
  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider>
        <ReactFlowProvider>
          <Variant nav={nav} />
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
