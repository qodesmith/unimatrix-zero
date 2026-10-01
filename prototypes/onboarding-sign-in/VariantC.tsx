// PROTOTYPE variant C: one "Connections" screen with two side-by-side cards that show every stage. The same screen is Settings later. Throw away.
import {useState} from 'react'

import {CanvasStub, CodeEntry, Progress, ReopenLink} from './harness'
import {INFO, Logo, PROVIDERS, errorAction, isBusy, statusLine, useSim, type ProviderId, type Status} from './sim'

export const name = 'Connections hub (side-by-side cards)'

export function VariantC() {
  const {state} = useSim()
  const [where, setWhere] = useState<'hub' | 'app' | 'settings'>('hub')
  const anyConnected = PROVIDERS.some(p => state.status[p].kind === 'connected')

  if (where === 'app') return <CanvasStub onSettings={() => setWhere('settings')} />

  const first = where === 'hub'
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-slate-50 p-8">
      {!first && (
        <button className="absolute top-4 left-4 text-sm text-slate-500" onClick={() => setWhere('app')}>
          ← Back to your Tree
        </button>
      )}
      <div className="text-center">
        <h1 className="text-3xl font-bold">{first ? 'Connect the AI you already pay for' : 'Connections'}</h1>
        <p className="mt-2 text-slate-600">{first ? 'One is enough to start. You can connect the other any time.' : 'Connect, reconnect or disconnect your AI accounts.'}</p>
      </div>
      <div className="flex gap-6">
        {PROVIDERS.map(p => (
          <Card key={p} p={p} />
        ))}
      </div>
      {first && (
        <button
          disabled={!anyConnected}
          onClick={() => setWhere('app')}
          className="rounded-xl bg-slate-900 px-8 py-3 text-lg text-white shadow disabled:opacity-30"
        >
          Start chatting →
        </button>
      )}
    </div>
  )
}

type Stage = 'ready' | 'signin' | 'code' | 'plan'
const stageOf = (s: Status): Stage | 'done' | null =>
  s.kind === 'downloading' ? 'ready' : s.kind === 'opening' || s.kind === 'waiting' ? 'signin' : s.kind === 'needs-code' ? 'code' : s.kind === 'checking' ? 'plan' : s.kind === 'connected' ? 'done' : null

function Card({p}: {p: ProviderId}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  const n = INFO[p].name
  const paste = p === 'claude' && state.knobs.claude.signIn === 'paste'
  const stages: {k: Stage; label: string}[] = [
    {k: 'ready', label: `Get ${n} ready`},
    {k: 'signin', label: `Sign in on ${n}'s page`},
    ...(paste ? [{k: 'code' as const, label: 'Paste the code'}] : []),
    {k: 'plan', label: 'Check your plan'},
  ]
  const cur = stageOf(st)
  const curIdx = cur === 'done' ? 99 : stages.findIndex(s => s.k === cur)
  const [lastIdx, setLastIdx] = useState(0)
  if (curIdx >= 0 && curIdx !== 99 && curIdx !== lastIdx) setLastIdx(curIdx)
  const failedIdx = st.kind === 'error' ? lastIdx : -1

  return (
    <div
      className={`flex w-80 flex-col gap-5 rounded-3xl border-2 bg-white p-6 shadow-sm ${st.kind === 'connected' ? 'border-green-400' : st.kind === 'error' ? 'border-red-300' : 'border-transparent'}`}
    >
      <div className="flex items-center gap-3">
        <Logo p={p} size={48} />
        <div>
          <div className="text-xl font-semibold">{n}</div>
          <div className="text-sm text-slate-500">
            {INFO[p].plans} · by {INFO[p].company}
          </div>
        </div>
      </div>
      {st.kind === 'connected' ? (
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-green-50 p-4 text-center">
          <div className="text-2xl">✓</div>
          <div className="font-medium">Connected</div>
          <div className="text-sm text-slate-600">{st.email}</div>
          <div className="rounded-full bg-white px-2 text-xs text-slate-500">
            {n} {st.plan}
          </div>
        </div>
      ) : st.kind === 'idle' ? (
        <div className="text-sm text-slate-500">Sign in with your {n} account. Your browser opens {n}'s page; we never see your password.</div>
      ) : (
        <ol className="space-y-3">
          {stages.map((s, i) => {
            const done = i < curIdx
            const now = i === curIdx
            const bad = i === failedIdx
            return (
              <li key={s.k} className="flex flex-col gap-1.5">
                <div className={`flex items-center gap-2 text-sm ${done ? 'text-slate-400' : now || bad ? 'font-medium' : 'text-slate-400'}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white ${bad ? 'bg-red-500' : done ? 'bg-green-500' : now ? 'animate-pulse bg-indigo-500' : 'bg-slate-200'}`}
                  >
                    {bad ? '!' : done ? '✓' : ''}
                  </span>
                  {s.label}
                </div>
                {now && st.kind === 'downloading' && <Progress pct={st.pct} color={INFO[p].color} />}
                {now && st.kind === 'waiting' && (
                  <div className="pl-7">
                    <ReopenLink p={p} />
                  </div>
                )}
                {now && s.k === 'code' && <CodeEntry p={p} />}
              </li>
            )
          })}
        </ol>
      )}
      {st.kind !== 'idle' && st.kind !== 'connected' && (
        <div className={`text-sm ${st.kind === 'error' ? 'text-red-600' : 'text-slate-600'}`}>{statusLine(p, st)}</div>
      )}
      <div className="mt-auto">
        {st.kind === 'idle' && (
          <button className="w-full rounded-xl py-3 font-medium text-white" style={{background: INFO[p].color}} onClick={() => dispatch({type: 'connect', p})}>
            Connect {n}
          </button>
        )}
        {isBusy(st) && (
          <button className="w-full rounded-xl border py-2 text-sm" onClick={() => dispatch({type: 'cancel', p})}>
            Cancel
          </button>
        )}
        {st.kind === 'error' && (
          <button className="w-full rounded-xl bg-slate-900 py-3 font-medium text-white" onClick={() => dispatch({type: 'connect', p})}>
            {errorAction(st.reason)}
          </button>
        )}
        {st.kind === 'connected' && (
          <button className="w-full py-2 text-sm text-slate-500 underline" onClick={() => dispatch({type: 'disconnect', p})}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  )
}
