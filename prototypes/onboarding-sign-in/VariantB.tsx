// PROTOTYPE variant B: no onboarding screen. The app opens on the empty Tree, and connecting happens from the Input itself. Throw away.
import {useEffect, useState} from 'react'

import {CanvasStub, CodeEntry, Progress, ReopenLink, SettingsSheet} from './harness'
import {INFO, Logo, PROVIDERS, errorAction, isBusy, statusLine, useSim, type ProviderId} from './sim'

export const name = 'Canvas first, connect from the Input'

export function VariantB() {
  const {state, dispatch} = useSim()
  const [settings, setSettings] = useState(false)
  const [menu, setMenu] = useState(false)
  const [text, setText] = useState('')
  const [queued, setQueued] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const connected = PROVIDERS.filter(p => state.status[p].kind === 'connected')
  const active = PROVIDERS.find(p => state.status[p].kind !== 'idle' && state.status[p].kind !== 'connected')
  const [model, setModel] = useState<ProviderId | null>(null)
  const current = model && state.status[model].kind === 'connected' ? model : connected[0]

  // A Prompt written before connecting sends itself once a Provider is connected.
  useEffect(() => {
    if (queued && current) {
      setSent(queued)
      setQueued(null)
    }
  }, [queued, current])

  const send = () => {
    if (!text.trim()) return
    if (current) setSent(text)
    else setQueued(text)
    setText('')
  }

  return (
    <>
      <CanvasStub onSettings={() => setSettings(true)}>
        {sent ? (
          <div className="flex w-[560px] flex-col gap-3">
            <div className="rounded-xl bg-indigo-50 p-3">{sent}</div>
            <div className="rounded-xl border bg-white p-3 text-slate-400">
              <span className="mr-2 inline-flex items-center gap-1 rounded-full border px-2 text-xs">
                <Logo p={current!} size={12} /> {INFO[current!].name}
              </span>
              (stub) the Reply would stream here. The onboarding is over.
            </div>
          </div>
        ) : (
          <div className="flex w-[600px] flex-col gap-3">
            {!connected.length && !active && (
              <div className="text-center">
                <div className="text-xl font-semibold">What do you want to talk about?</div>
                <div className="text-sm text-slate-500">First, connect the AI you already pay for.</div>
              </div>
            )}
            <div className="rounded-2xl border bg-white p-3 shadow-sm">
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                className="h-20 w-full resize-none outline-none"
                placeholder="Ask anything…"
                disabled={!!queued}
              />
              {queued && <div className="mb-2 rounded-lg bg-amber-50 p-2 text-sm">“{queued}” will send as soon as you're connected.</div>}
              <div className="relative flex items-center gap-2">
                <span className="text-slate-400">📎</span>
                <div className="flex-1" />
                <button onClick={() => setMenu(!menu)} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
                  {current ? (
                    <>
                      <Logo p={current} size={14} /> {current === 'claude' ? 'Claude Opus' : 'GPT-5.1'}
                    </>
                  ) : (
                    'Choose an AI'
                  )}{' '}
                  ▾
                </button>
                {menu && (
                  <div className="absolute right-16 bottom-9 z-10 w-72 rounded-xl border bg-white p-1 shadow-lg">
                    {PROVIDERS.map(p => {
                      const st = state.status[p]
                      return st.kind === 'connected' ? (
                        <button key={p} className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-slate-100" onClick={() => (setModel(p), setMenu(false))}>
                          <Logo p={p} size={18} /> {p === 'claude' ? 'Claude Opus' : 'GPT-5.1'}
                          <span className="ml-auto text-xs text-slate-400">{st.plan}</span>
                        </button>
                      ) : (
                        <button
                          key={p}
                          className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-slate-500 hover:bg-slate-100"
                          onClick={() => {
                            if (st.kind === 'idle' || st.kind === 'error') dispatch({type: 'connect', p})
                            setMenu(false)
                          }}
                        >
                          <Logo p={p} size={18} /> {INFO[p].name}
                          <span className="ml-auto text-xs font-medium text-indigo-600">{isBusy(st) ? 'Connecting…' : 'Connect'}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <button onClick={send} className="rounded-lg bg-slate-900 px-3 py-1 text-sm text-white">
                  Send
                </button>
              </div>
            </div>
            {!connected.length && !active && (
              <div className="flex justify-center gap-3">
                {PROVIDERS.map(p => (
                  <button key={p} onClick={() => dispatch({type: 'connect', p})} className="flex items-center gap-2 rounded-full border bg-white px-4 py-2 shadow-sm hover:shadow">
                    <Logo p={p} size={20} /> Connect {INFO[p].name}
                  </button>
                ))}
              </div>
            )}
            {PROVIDERS.filter(p => state.status[p].kind !== 'idle' && state.status[p].kind !== 'connected').map(p => (
              <Strip key={p} p={p} />
            ))}
          </div>
        )}
      </CanvasStub>
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </>
  )
}

// Inline status that hangs under the Input while a Provider connects.
function Strip({p}: {p: ProviderId}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 ${st.kind === 'error' ? 'border-red-200 bg-red-50' : 'bg-white'}`}>
      <div className="flex items-center gap-2 text-sm">
        <Logo p={p} size={18} />
        <span className="flex-1">{statusLine(p, st)}</span>
        {st.kind === 'error' ? (
          <>
            <button className="text-slate-500" onClick={() => dispatch({type: 'cancel', p})}>
              Dismiss
            </button>
            <button className="rounded-lg bg-slate-900 px-2 py-1 text-white" onClick={() => dispatch({type: 'connect', p})}>
              {errorAction(st.reason)}
            </button>
          </>
        ) : (
          <button className="text-slate-500" onClick={() => dispatch({type: 'cancel', p})}>
            Cancel
          </button>
        )}
      </div>
      {st.kind === 'downloading' && <Progress pct={st.pct} color={INFO[p].color} />}
      {st.kind === 'waiting' && <ReopenLink p={p} />}
      <CodeEntry p={p} />
    </div>
  )
}
