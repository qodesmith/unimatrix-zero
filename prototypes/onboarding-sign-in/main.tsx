// PROTOTYPE: Onboarding and sign-in flow, four variants switchable via ?variant=A|B|C|D. Throw away.
// The vendor's sign-in page is simulated as a floating "browser" window; the debug panel forces each failure.
import {useState} from 'react'
import {createRoot} from 'react-dom/client'

import {DebugPanel, FakeBrowser, PrototypeSwitcher} from './harness'
import {SimProvider, useProviderSim} from './sim'
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
  const sim = useProviderSim()
  const [run, setRun] = useState(0)
  const [variant, setVariant] = useState(() => new URLSearchParams(location.search).get('variant') ?? 'A')
  // Every switch or reset is a fresh first launch, so variants never inherit each other's connections.
  const restart = () => {
    sim.dispatch({type: 'reset'})
    setRun(r => r + 1)
  }
  const change = (key: string) => {
    const url = new URL(location.href)
    url.searchParams.set('variant', key)
    history.replaceState(null, '', url)
    setVariant(key)
    restart()
  }
  const Current = (VARIANTS.find(v => v.key === variant) ?? VARIANTS[0]!).Component

  return (
    <SimProvider sim={sim}>
      <Current key={`${variant}-${run}`} />
      <FakeBrowser />
      <DebugPanel onReset={restart} />
      {process.env.NODE_ENV !== 'production' && <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />}
    </SimProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
