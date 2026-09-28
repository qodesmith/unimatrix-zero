// PROTOTYPE: Canvas mode UX, variants switchable via ?variant=A|B|C|D (D is the default). Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useState} from 'react'
import {createRoot} from 'react-dom/client'

import {
  DebugPanel,
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
} from './shared'
import {useTreeSim} from './tree'
import * as A from './VariantA'
import * as B from './VariantB'
import * as C from './VariantC'
import * as D from './VariantD'

const VARIANTS = [
  {key: 'A', name: A.name, Component: A.VariantA},
  {key: 'B', name: B.name, Component: B.VariantB},
  {key: 'C', name: C.name, Component: C.VariantC},
  {key: 'D', name: D.name, Component: D.VariantD},
]

function App() {
  const sim = useTreeSim()
  const [variant, setVariant] = useState(
    () => new URLSearchParams(location.search).get('variant') ?? 'D'
  )
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }
  const Current = (VARIANTS.find(v => v.key === variant) ?? VARIANTS[3]!)
    .Component

  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider key={variant}>
        <ReactFlowProvider>
          <Current />
        </ReactFlowProvider>
      </HighlightProvider>
      <DebugPanel sim={sim} />
      {process.env.NODE_ENV !== 'production' && (
        <PrototypeSwitcher
          variants={VARIANTS}
          current={variant}
          onChange={change}
        />
      )}
    </SimContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
