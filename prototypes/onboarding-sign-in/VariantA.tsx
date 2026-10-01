// PROTOTYPE variant A: a full-screen, one-thing-per-screen welcome wizard before the app appears. Throw away.
import {useEffect, useState} from 'react'

import {CanvasStub, CodeEntry, Progress, ReopenLink, SettingsSheet} from './harness'
import {INFO, Logo, PROVIDERS, errorAction, statusLine, useSim, type ProviderId} from './sim'

export const name = 'Welcome wizard'

type Step = {kind: 'welcome'} | {kind: 'pick'} | {kind: 'connect'; i: number} | {kind: 'done'} | {kind: 'app'}

export function VariantA() {
  const [step, setStep] = useState<Step>({kind: 'welcome'})
  const [picked, setPicked] = useState<ProviderId[]>([])
  const [settings, setSettings] = useState(false)

  if (step.kind === 'app')
    return (
      <>
        <CanvasStub onSettings={() => setSettings(true)} />
        {settings && <SettingsSheet onClose={() => setSettings(false)} />}
      </>
    )

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-indigo-50 to-white">
      <div className="flex w-[520px] flex-col items-center gap-6 text-center">
        <Dots step={step} total={picked.length} />
        {step.kind === 'welcome' && (
          <>
            <div className="text-4xl">🌳</div>
            <h1 className="text-3xl font-bold">Welcome to Unimatrix Zero</h1>
            <p className="text-lg text-slate-600">
              Talk with Claude or ChatGPT, and branch any conversation into as many directions as you like. It uses the plan you already pay for.
            </p>
            <Big onClick={() => setStep({kind: 'pick'})}>Get started</Big>
          </>
        )}
        {step.kind === 'pick' && (
          <>
            <h1 className="text-2xl font-bold">Which do you pay for?</h1>
            <p className="text-slate-600">Pick one or both. You can add the other later.</p>
            <div className="flex w-full gap-4">
              {PROVIDERS.map(p => {
                const on = picked.includes(p)
                return (
                  <button
                    key={p}
                    onClick={() => setPicked(on ? picked.filter(x => x !== p) : [...picked, p])}
                    className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 bg-white p-6 ${on ? 'border-indigo-500 ring-4 ring-indigo-100' : 'border-slate-200'}`}
                  >
                    <Logo p={p} size={48} />
                    <div className="text-lg font-semibold">{INFO[p].name}</div>
                    <div className="text-sm text-slate-500">{INFO[p].plans}</div>
                    <div className={`mt-1 h-6 w-6 rounded-full border-2 ${on ? 'border-indigo-500 bg-indigo-500 text-white' : ''}`}>{on && '✓'}</div>
                  </button>
                )
              })}
            </div>
            <details className="text-sm text-slate-500">
              <summary className="cursor-pointer">I'm not sure / I only have a free account</summary>
              <p className="mt-2">
                Unimatrix Zero works with a paid plan: Claude Pro or Max, or ChatGPT Plus or Pro. If you don't have one, you can sign up on claude.ai or chatgpt.com, then come back.
              </p>
            </details>
            <Big disabled={!picked.length} onClick={() => setStep({kind: 'connect', i: 0})}>
              Continue
            </Big>
          </>
        )}
        {step.kind === 'connect' && (
          <ConnectStep
            key={picked[step.i]}
            p={picked[step.i]!}
            last={step.i === picked.length - 1}
            onNext={() => setStep(step.i < picked.length - 1 ? {kind: 'connect', i: step.i + 1} : {kind: 'done'})}
            onBack={() => setStep(step.i ? {kind: 'connect', i: step.i - 1} : {kind: 'pick'})}
          />
        )}
        {step.kind === 'done' && <Done onGo={() => setStep({kind: 'app'})} />}
      </div>
    </div>
  )
}

function ConnectStep({p, last, onNext, onBack}: {p: ProviderId; last: boolean; onNext: () => void; onBack: () => void}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  const n = INFO[p].name
  const paste = p === 'claude' && state.knobs.claude.signIn === 'paste'
  const stage =
    st.kind === 'downloading' ? 1 : st.kind === 'opening' || st.kind === 'waiting' ? 2 : st.kind === 'needs-code' ? 3 : st.kind === 'checking' ? 4 : st.kind === 'connected' ? 5 : 0
  const steps = [
    `We get ${n} ready on this computer (about a minute)`,
    `${n}'s page opens in your web browser. Sign in and click ${p === 'claude' ? 'Authorize' : 'Continue'}.`,
    ...(paste ? [`${n}'s page shows a code. Copy it and paste it here.`] : []),
  ]
  const active = stage === 0 ? -1 : stage === 1 ? 0 : stage === 2 ? 1 : stage === 3 ? 2 : 99

  useEffect(() => {
    if (st.kind === 'connected') {
      const t = setTimeout(onNext, 1600)
      return () => clearTimeout(t)
    }
  }, [st.kind])

  return (
    <>
      <Logo p={p} size={64} />
      <h1 className="text-2xl font-bold">Connect {n}</h1>
      <ol className="w-full space-y-2 text-left">
        {steps.map((s, i) => (
          <li key={i} className={`flex gap-3 rounded-xl p-3 ${i === active ? 'bg-white shadow' : ''} ${i < active ? 'text-slate-400' : ''}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm text-white ${i < active ? 'bg-green-500' : i === active ? 'bg-indigo-500' : 'bg-slate-300'}`}>
              {i < active ? '✓' : i + 1}
            </span>
            <div className="flex flex-1 flex-col gap-2">
              <span>{s}</span>
              {i === 0 && st.kind === 'downloading' && <Progress pct={st.pct} color={INFO[p].color} />}
              {i === 1 && st.kind === 'waiting' && <ReopenLink p={p} />}
              {i === 2 && <CodeEntry p={p} big />}
            </div>
          </li>
        ))}
      </ol>
      <div className={`min-h-6 ${st.kind === 'error' ? 'text-red-600' : 'text-slate-600'}`}>{stage === 0 && st.kind === 'idle' ? '' : statusLine(p, st)}</div>
      {st.kind === 'idle' && <Big onClick={() => dispatch({type: 'connect', p})}>Connect {n}</Big>}
      {st.kind === 'error' && <Big onClick={() => dispatch({type: 'connect', p})}>{errorAction(st.reason)}</Big>}
      {st.kind === 'connected' && <div className="text-3xl">🎉</div>}
      <div className="flex gap-4 text-sm text-slate-500">
        <button onClick={onBack}>← Back</button>
        {st.kind !== 'connected' && (
          <button onClick={onNext} className="underline">
            {last ? 'Skip for now' : `Skip ${n}`}
          </button>
        )}
      </div>
    </>
  )
}

function Done({onGo}: {onGo: () => void}) {
  const {state} = useSim()
  const connected = PROVIDERS.filter(p => state.status[p].kind === 'connected')
  return (
    <>
      <div className="text-5xl">✨</div>
      <h1 className="text-2xl font-bold">{connected.length ? "You're all set" : 'Nothing connected yet'}</h1>
      {connected.map(p => (
        <div key={p} className="flex items-center gap-2 text-slate-600">
          <Logo p={p} size={20} /> {statusLine(p, state.status[p])}
        </div>
      ))}
      {!connected.length && <p className="text-slate-600">You can connect Claude or ChatGPT any time from Settings.</p>}
      <Big onClick={onGo}>Start your first conversation</Big>
    </>
  )
}

function Dots({step, total}: {step: Step; total: number}) {
  const n = 2 + Math.max(total, 1) + 1
  const at = step.kind === 'welcome' ? 0 : step.kind === 'pick' ? 1 : step.kind === 'connect' ? 2 + step.i : n - 1
  return (
    <div className="flex gap-1.5">
      {Array.from({length: n}, (_, i) => (
        <span key={i} className={`h-1.5 rounded-full ${i === at ? 'w-6 bg-indigo-500' : 'w-1.5 bg-slate-300'}`} />
      ))}
    </div>
  )
}

function Big(props: {onClick: () => void; disabled?: boolean; children: React.ReactNode}) {
  return (
    <button {...props} className="rounded-xl bg-indigo-600 px-8 py-3 text-lg font-medium text-white shadow disabled:opacity-40" />
  )
}
