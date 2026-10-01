// PROTOTYPE: switcher, debug panel, simulated browser, and shared app stubs. Throw away.
import {useCallback, useEffect, useState, type ReactNode} from 'react'

import {
  INFO,
  Logo,
  PROVIDERS,
  errorAction,
  isBusy,
  statusLine,
  useSim,
  type Knobs,
  type ProviderId,
  type Status,
} from './sim'

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: {key: string; name: string}[]
  current: string
  onChange: (k: string) => void
}) {
  const idx = Math.max(
    0,
    variants.findIndex(v => v.key === current)
  )
  const go = useCallback(
    (d: number) => onChange(variants[(idx + d + variants.length) % variants.length]!.key),
    [idx, variants, onChange]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])
  const v = variants[idx]!
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-700 px-3 py-1.5 font-mono text-sm text-white shadow-lg">
      <button onClick={() => go(-1)} className="px-1 hover:text-fuchsia-200">
        ←
      </button>
      <span>
        {v.key} ({v.name})
      </span>
      <button onClick={() => go(1)} className="px-1 hover:text-fuchsia-200">
        →
      </button>
    </div>
  )
}

// ---------- debug panel: force every failure, see the full state ----------

export function DebugPanel({onReset}: {onReset: () => void}) {
  const {state, dispatch} = useSim()
  const [open, setOpen] = useState(true)
  const k = state.knobs
  const setK = (knobs: Knobs) => dispatch({type: 'knobs', knobs})
  const sel = 'rounded border border-slate-600 bg-slate-800 px-1 text-xs'
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-[100] rounded bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200">
        debug ▸
      </button>
    )
  return (
    <div className="fixed bottom-4 left-4 z-[100] w-80 rounded-lg bg-slate-900/95 p-3 font-mono text-xs text-slate-200 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-fuchsia-300">PROTOTYPE debug</span>
        <div className="flex gap-2">
          <button onClick={onReset} className="rounded bg-fuchsia-700 px-2">
            reset to first launch
          </button>
          <button onClick={() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
        <span>offline</span>
        <input type="checkbox" checked={k.offline} onChange={e => setK({...k, offline: e.target.checked})} />
        <span>speed</span>
        <select className={sel} value={k.speed} onChange={e => setK({...k, speed: Number(e.target.value) as 1 | 3})}>
          <option value={1}>normal</option>
          <option value={3}>fast</option>
        </select>
        <span>claude dl</span>
        <select className={sel} value={k.claude.download} onChange={e => setK({...k, claude: {...k.claude, download: e.target.value as 'ok'}})}>
          <option>ok</option>
          <option>fail</option>
        </select>
        <span>claude sign-in</span>
        <select className={sel} value={k.claude.signIn} onChange={e => setK({...k, claude: {...k.claude, signIn: e.target.value as 'auto'}})}>
          <option value="paste">paste code</option>
          <option value="auto">automatic</option>
        </select>
        <span>claude plan</span>
        <select className={sel} value={k.claude.plan} onChange={e => setK({...k, claude: {...k.claude, plan: e.target.value as 'Pro'}})}>
          <option>Pro</option>
          <option>Max</option>
          <option>Free</option>
        </select>
        <span>chatgpt dl</span>
        <select className={sel} value={k.chatgpt.download} onChange={e => setK({...k, chatgpt: {...k.chatgpt, download: e.target.value as 'ok'}})}>
          <option>ok</option>
          <option>fail</option>
        </select>
        <span>chatgpt plan</span>
        <select className={sel} value={k.chatgpt.plan} onChange={e => setK({...k, chatgpt: {...k.chatgpt, plan: e.target.value as 'Plus'}})}>
          <option>Plus</option>
          <option>Pro</option>
          <option value="Free">Free (unverified)</option>
        </select>
      </div>
      <div className="mt-2 space-y-1 border-t border-slate-700 pt-2">
        {PROVIDERS.map(p => (
          <div key={p} className="flex items-center justify-between">
            <span>
              {p}: <span className="text-amber-300">{describe(state.status[p])}</span>
            </span>
            {(state.status[p].kind === 'waiting' || state.status[p].kind === 'needs-code') && (
              <button className="rounded bg-slate-700 px-1" onClick={() => dispatch({type: 'timeout', p})}>
                force timeout
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 max-h-28 overflow-auto border-t border-slate-700 pt-2 text-slate-400">
        {state.log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

const describe = (s: Status) =>
  s.kind === 'downloading' ? `downloading ${s.pct}%` : s.kind === 'error' ? `error:${s.reason}` : s.kind === 'needs-code' ? `needs-code (${s.code})` : s.kind

// ---------- the user's real browser, simulated ----------

export function FakeBrowser() {
  const {state, dispatch} = useSim()
  const p = state.browser
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
  }, [p, state.browserStep])
  if (!p) return null
  const st = state.status[p]
  const claude = p === 'claude'
  const url = claude ? 'claude.ai/oauth/authorize?client=claude-code…' : 'auth.openai.com/authorize?client=codex…'
  return (
    <div className="fixed top-10 right-10 z-[90] w-[420px] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
      <div className="flex items-center gap-2 border-b bg-slate-100 px-3 py-2">
        <button onClick={() => dispatch({type: 'closeBrowser'})} className="h-3 w-3 rounded-full bg-red-400" title="Close tab" />
        <span className="h-3 w-3 rounded-full bg-amber-300" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <div className="ml-2 flex-1 truncate rounded bg-white px-2 py-0.5 font-mono text-[11px] text-slate-500">{url}</div>
      </div>
      <div className="bg-fuchsia-50 px-3 py-1 font-mono text-[10px] text-fuchsia-700">
        SIMULATED: this is the user's own web browser, not our app. Red dot = close the tab.
      </div>
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <Logo p={p} size={44} />
        {state.browserStep === 'consent' && (
          <>
            <div className="text-lg font-semibold">
              {claude ? 'Claude Code would like to connect to your Claude account' : 'Sign in to Codex with ChatGPT'}
            </div>
            <div className="text-sm text-slate-500">
              Signed in as {claude ? 'sam@example.com' : 'sam.parent@gmail.com'}
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg border px-4 py-2" onClick={() => dispatch({type: 'deny', p})}>
                {claude ? 'Decline' : 'Cancel'}
              </button>
              <button className="rounded-lg px-4 py-2 text-white" style={{background: INFO[p].color}} onClick={() => dispatch({type: 'authorize', p})}>
                {claude ? 'Authorize' : 'Continue'}
              </button>
            </div>
            <div className="text-[11px] text-fuchsia-700">
              Note: the vendor page names {claude ? 'Claude Code' : 'Codex'}, not Unimatrix Zero, because their unmodified program runs the sign-in.
            </div>
          </>
        )}
        {state.browserStep === 'code' && st.kind === 'needs-code' && (
          <>
            <div className="text-lg font-semibold">Paste this into Claude Code</div>
            <div className="rounded-lg bg-slate-100 px-4 py-3 font-mono text-lg tracking-wider select-all">{st.code}</div>
            <button
              className="rounded-lg border px-4 py-2"
              onClick={() => {
                navigator.clipboard?.writeText(st.code)
                setCopied(true)
              }}
            >
              {copied ? 'Copied ✓' : 'Copy code'}
            </button>
          </>
        )}
        {state.browserStep === 'done' && (
          <>
            <div className="text-lg font-semibold">{claude ? 'Login successful' : 'Signed in to Codex'}</div>
            <div className="text-sm text-slate-500">You can close this page and return to the app.</div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- small shared pieces ----------

export function CodeEntry({p, big = false}: {p: ProviderId; big?: boolean}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  const [v, setV] = useState('')
  if (st.kind !== 'needs-code') return null
  return (
    <form
      className="flex w-full flex-col gap-1"
      onSubmit={e => {
        e.preventDefault()
        dispatch({type: 'submitCode', p, code: v})
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={v}
          onChange={e => setV(e.target.value)}
          onPaste={e => {
            const text = e.clipboardData.getData('text')
            setTimeout(() => dispatch({type: 'submitCode', p, code: text}), 0)
          }}
          placeholder="Paste the code here"
          className={`flex-1 rounded-lg border px-3 font-mono ${big ? 'py-3 text-lg' : 'py-1.5 text-sm'}`}
        />
        <button className="rounded-lg bg-slate-900 px-3 text-sm text-white">Connect</button>
      </div>
      {st.wrong && <div className="text-xs text-red-600">That code didn't match. Copy it again from {INFO[p].name}'s page.</div>}
    </form>
  )
}

export function Progress({pct, color}: {pct: number; color: string}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full transition-all" style={{width: `${pct}%`, background: color}} />
    </div>
  )
}

// What the app can say when the browser page might not be in front of the user.
export function ReopenLink({p}: {p: ProviderId}) {
  const {dispatch} = useSim()
  return (
    <button className="text-xs text-slate-500 underline" onClick={() => dispatch({type: 'reopenBrowser', p})}>
      Don't see the page? Open it again
    </button>
  )
}

// Compact row: used by Settings in every variant.
export function ProviderRow({p}: {p: ProviderId}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-white p-3">
      <div className="flex items-center gap-3">
        <Logo p={p} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{INFO[p].name}</div>
          <div className={`truncate text-xs ${st.kind === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{statusLine(p, st)}</div>
        </div>
        {st.kind === 'idle' && (
          <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => dispatch({type: 'connect', p})}>
            Connect
          </button>
        )}
        {isBusy(st) && (
          <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => dispatch({type: 'cancel', p})}>
            Cancel
          </button>
        )}
        {st.kind === 'error' && (
          <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => dispatch({type: 'connect', p})}>
            {errorAction(st.reason)}
          </button>
        )}
        {st.kind === 'connected' && !confirm && (
          <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setConfirm(true)}>
            Disconnect
          </button>
        )}
      </div>
      {st.kind === 'downloading' && <Progress pct={st.pct} color={INFO[p].color} />}
      {st.kind === 'waiting' && <ReopenLink p={p} />}
      <CodeEntry p={p} />
      {confirm && st.kind === 'connected' && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs">
          <span className="flex-1">Disconnect {INFO[p].name}? Your Trees stay. To keep using {INFO[p].name}, you'll sign in again.</span>
          <button className="rounded border px-2 py-1" onClick={() => setConfirm(false)}>
            Keep
          </button>
          <button
            className="rounded bg-red-600 px-2 py-1 text-white"
            onClick={() => {
              setConfirm(false)
              dispatch({type: 'disconnect', p})
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}

export function SettingsSheet({onClose}: {onClose: () => void}) {
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-black/20" onClick={onClose}>
      <div className="flex h-full w-[420px] flex-col gap-4 bg-slate-50 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Settings</div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">AI you're connected to</div>
        {PROVIDERS.map(p => (
          <ProviderRow key={p} p={p} />
        ))}
        <div className="text-xs text-slate-400">Other settings (theme, orientation…) live in the Settings ticket.</div>
      </div>
    </div>
  )
}

// The real empty-Tree state from the Canvas mode UX decision: one centred Input on a dotted canvas.
export function CanvasStub({children, onSettings, top}: {children?: ReactNode; onSettings: () => void; top?: ReactNode}) {
  const {state} = useSim()
  const connected = PROVIDERS.filter(p => state.status[p].kind === 'connected')
  return (
    <div className="relative flex h-full flex-col" style={{backgroundImage: 'radial-gradient(#d4d4d8 1px, transparent 1px)', backgroundSize: '20px 20px'}}>
      <div className="flex items-center gap-3 border-b bg-white/80 px-4 py-2 backdrop-blur">
        <span className="font-semibold">Unimatrix Zero</span>
        <span className="text-sm text-slate-400">· New Tree</span>
        <div className="flex-1" />
        {top}
        <button onClick={onSettings} className="rounded-lg border bg-white px-2 py-1 text-sm" title="Settings">
          ⚙ Settings
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {children ?? (
          <div className="w-[560px] rounded-2xl border bg-white p-3 shadow-sm">
            <textarea className="h-20 w-full resize-none outline-none" placeholder="Ask anything…" />
            <div className="flex items-center gap-2">
              <span className="text-slate-400">📎</span>
              <div className="flex-1" />
              {connected[0] && (
                <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                  <Logo p={connected[0]} size={14} /> {connected[0] === 'claude' ? 'Claude Opus' : 'GPT-5.1'} ▾
                </span>
              )}
              <button className="rounded-lg bg-slate-900 px-3 py-1 text-sm text-white">Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
