// PROTOTYPE: simulated Provider connection state shared by every variant. Throw away.
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'

export type ProviderId = 'claude' | 'chatgpt'
export const PROVIDERS: ProviderId[] = ['claude', 'chatgpt']

export const INFO: Record<
  ProviderId,
  {name: string; company: string; plans: string; sizeMb: number; color: string}
> = {
  claude: {
    name: 'Claude',
    company: 'Anthropic',
    plans: 'Pro or Max',
    sizeMb: 100,
    color: '#d97757',
  },
  chatgpt: {
    name: 'ChatGPT',
    company: 'OpenAI',
    plans: 'Plus or Pro',
    sizeMb: 98,
    color: '#10a37f',
  },
}

export type ErrorReason =
  | 'download'
  | 'offline'
  | 'cancelled'
  | 'timeout'
  | 'free-plan'

export type Status =
  | {kind: 'idle'}
  | {kind: 'downloading'; pct: number}
  | {kind: 'opening'}
  | {kind: 'waiting'}
  | {kind: 'needs-code'; code: string; wrong: boolean}
  | {kind: 'checking'}
  | {kind: 'connected'; email: string; plan: string}
  | {kind: 'error'; reason: ErrorReason}

// Knobs the debug panel turns, so every failure can be forced on demand.
export type Knobs = {
  offline: boolean
  speed: 1 | 3
  claude: {download: 'ok' | 'fail'; signIn: 'auto' | 'paste'; plan: 'Pro' | 'Max' | 'Free'}
  chatgpt: {download: 'ok' | 'fail'; plan: 'Plus' | 'Pro' | 'Free'}
  // Already downloaded from an earlier connect: reconnecting skips the download.
  ready: Record<ProviderId, boolean>
}

export type State = {
  status: Record<ProviderId, Status>
  knobs: Knobs
  browser: ProviderId | null // which vendor page the fake browser is showing
  browserStep: 'consent' | 'code' | 'done'
  log: string[]
}

export type Action =
  | {type: 'connect'; p: ProviderId}
  | {type: 'cancel'; p: ProviderId}
  | {type: 'tick'; p: ProviderId}
  | {type: 'opened'; p: ProviderId}
  | {type: 'authorize'; p: ProviderId}
  | {type: 'deny'; p: ProviderId}
  | {type: 'closeBrowser'}
  | {type: 'reopenBrowser'; p: ProviderId}
  | {type: 'submitCode'; p: ProviderId; code: string}
  | {type: 'checked'; p: ProviderId}
  | {type: 'timeout'; p: ProviderId}
  | {type: 'disconnect'; p: ProviderId}
  | {type: 'knobs'; knobs: Knobs}
  | {type: 'reset'}

const initialKnobs: Knobs = {
  offline: false,
  speed: 1,
  claude: {download: 'ok', signIn: 'paste', plan: 'Max'},
  chatgpt: {download: 'ok', plan: 'Plus'},
  ready: {claude: false, chatgpt: false},
}

const initial = (knobs = initialKnobs): State => ({
  status: {claude: {kind: 'idle'}, chatgpt: {kind: 'idle'}},
  knobs: {...knobs, ready: {claude: false, chatgpt: false}},
  browser: null,
  browserStep: 'consent',
  log: ['first launch: no Providers connected'],
})

const code = () =>
  Array.from({length: 3}, () => Math.random().toString(36).slice(2, 6)).join('-')

function reducer(s: State, a: Action): State {
  const set = (p: ProviderId, st: Status, msg: string): State => ({
    ...s,
    status: {...s.status, [p]: st},
    log: [`${p}: ${msg}`, ...s.log].slice(0, 30),
  })
  switch (a.type) {
    case 'connect': {
      if (s.knobs.offline) return set(a.p, {kind: 'error', reason: 'offline'}, 'offline')
      if (s.knobs.ready[a.p]) return set(a.p, {kind: 'opening'}, 'program already here, opening sign-in page')
      return set(a.p, {kind: 'downloading', pct: 0}, 'connect → downloading program')
    }
    case 'tick': {
      const st = s.status[a.p]
      if (st.kind !== 'downloading') return s
      const k = s.knobs[a.p]
      if (k.download === 'fail' && st.pct >= 40)
        return set(a.p, {kind: 'error', reason: 'download'}, 'download failed at 40%')
      const pct = Math.min(100, st.pct + 4 * s.knobs.speed)
      if (pct < 100) return {...s, status: {...s.status, [a.p]: {kind: 'downloading', pct}}}
      return {
        ...set(a.p, {kind: 'opening'}, 'download done, hash checked → opening sign-in page'),
        knobs: {...s.knobs, ready: {...s.knobs.ready, [a.p]: true}},
      }
    }
    case 'opened':
      return {...set(a.p, {kind: 'waiting'}, 'browser opened at vendor sign-in page'), browser: a.p, browserStep: 'consent'}
    case 'reopenBrowser':
      return {...s, browser: a.p, browserStep: 'consent', log: [`${a.p}: sign-in page opened again`, ...s.log]}
    case 'closeBrowser':
      return {...s, browser: null}
    case 'authorize': {
      if (a.p === 'claude' && s.knobs.claude.signIn === 'paste')
        return {...set(a.p, {kind: 'needs-code', code: code(), wrong: false}, 'authorized → page shows a code to paste'), browserStep: 'code'}
      return {...set(a.p, {kind: 'checking'}, 'authorized → app notified automatically'), browserStep: 'done'}
    }
    case 'deny':
      return {...set(a.p, {kind: 'error', reason: 'cancelled'}, 'user cancelled on the sign-in page'), browser: null}
    case 'submitCode': {
      const st = s.status[a.p]
      if (st.kind !== 'needs-code') return s
      const norm = (x: string) => x.replace(/\s/g, '').toLowerCase()
      if (norm(a.code) !== norm(st.code))
        return set(a.p, {...st, wrong: true}, 'pasted code did not match')
      return {...set(a.p, {kind: 'checking'}, 'code accepted → checking plan'), browser: null}
    }
    case 'checked': {
      const plan = s.knobs[a.p].plan
      // Claude's free plan can't drive Claude Code. ChatGPT Free: unverified, so the sim lets it through.
      if (a.p === 'claude' && plan === 'Free')
        return set(a.p, {kind: 'error', reason: 'free-plan'}, 'signed in, but account is on Free')
      return set(
        a.p,
        {kind: 'connected', email: a.p === 'claude' ? 'sam@example.com' : 'sam.parent@gmail.com', plan},
        `connected (${plan})`
      )
    }
    case 'timeout':
      return {...set(a.p, {kind: 'error', reason: 'timeout'}, 'sign-in timed out'), browser: null}
    case 'cancel':
      return {...set(a.p, {kind: 'idle'}, 'user cancelled in the app'), browser: s.browser === a.p ? null : s.browser}
    case 'disconnect':
      return set(a.p, {kind: 'idle'}, 'disconnected (signed out)')
    case 'knobs':
      return {...s, knobs: a.knobs}
    case 'reset':
      return initial(s.knobs)
  }
}

// Drives the timers: download progress, the beat before the browser opens, and the plan check.
export function useProviderSim() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initial())
  const {status, knobs} = state
  for (const p of PROVIDERS) {
    const kind = status[p].kind
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (kind === 'downloading') {
        const t = setInterval(() => dispatch({type: 'tick', p}), 120)
        return () => clearInterval(t)
      }
      if (kind === 'opening') {
        const t = setTimeout(() => dispatch({type: 'opened', p}), 900 / knobs.speed)
        return () => clearTimeout(t)
      }
      if (kind === 'checking') {
        const t = setTimeout(() => dispatch({type: 'checked', p}), 1100 / knobs.speed)
        return () => clearTimeout(t)
      }
    }, [kind, knobs.speed])
  }
  return {state, dispatch}
}

export type Sim = ReturnType<typeof useProviderSim>
export const SimContext = createContext<Sim | null>(null)
export const useSim = () => useContext(SimContext)!

export function SimProvider({sim, children}: {sim: Sim; children: ReactNode}) {
  return <SimContext.Provider value={sim}>{children}</SimContext.Provider>
}

export const isBusy = (s: Status) =>
  s.kind === 'downloading' || s.kind === 'opening' || s.kind === 'waiting' || s.kind === 'needs-code' || s.kind === 'checking'

// One plain-language line per state. Every variant uses this wording so the variants differ in structure, not copy.
export function statusLine(p: ProviderId, s: Status): string {
  const n = INFO[p].name
  switch (s.kind) {
    case 'idle':
      return 'Not connected'
    case 'downloading':
      return `Getting ${n} ready… ${Math.round((s.pct / 100) * INFO[p].sizeMb)} of ${INFO[p].sizeMb} MB`
    case 'opening':
      return `Opening ${n}'s sign-in page in your browser…`
    case 'waiting':
      return `Finish signing in on ${n}'s page in your browser`
    case 'needs-code':
      return `${n}'s page shows a code. Copy it and paste it here.`
    case 'checking':
      return 'Checking your plan…'
    case 'connected':
      return `Connected as ${s.email} · ${n} ${s.plan}`
    case 'error':
      return errorLine(p, s.reason)
  }
}

export function errorLine(p: ProviderId, r: ErrorReason): string {
  const n = INFO[p].name
  switch (r) {
    case 'download':
      return `Couldn't get ${n} ready. Check your internet connection and try again.`
    case 'offline':
      return "You're offline. Connect to the internet and try again."
    case 'cancelled':
      return `Sign-in was cancelled on ${n}'s page. You can try again.`
    case 'timeout':
      return `We didn't hear back from ${n}'s page. Try again.`
    case 'free-plan':
      return `This ${n} account is on the free plan. Unimatrix Zero needs ${n} ${INFO[p].plans}.`
  }
}

export const errorAction = (r: ErrorReason) =>
  r === 'free-plan' ? 'Use a different account' : 'Try again'

export function Logo({p, size = 32}: {p: ProviderId; size?: number}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{background: INFO[p].color, width: size, height: size, fontSize: size * 0.45}}
    >
      {p === 'claude' ? '✳' : '◎'}
    </div>
  )
}
