// PROTOTYPE: Canvas mode UX, three variants switchable via ?variant=A|B|C. Throw away.
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

const VARIANTS = [
  {key: 'A', name: A.name, Component: A.VariantA},
  {key: 'B', name: B.name, Component: B.VariantB},
  {key: 'C', name: C.name, Component: C.VariantC},
]

function App() {
  const sim = useTreeSim()
  const [variant, setVariant] = useState(
    () => new URLSearchParams(location.search).get('variant') ?? 'A'
  )
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
  }
  const Current = (VARIANTS.find(v => v.key === variant) ?? VARIANTS[0]!)
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
