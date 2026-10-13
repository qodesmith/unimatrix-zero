// PROTOTYPE: fake app-wide health for the Reconnect, offline and error states ticket (#40): sign-in, the network, each
// Provider's vendor program, outages on the vendor's side, and the app update. Real clock, in memory. Throw away.
import {useSyncExternalStore} from 'react'

import {issueHooks, type Issue, type Turn} from '../canvas-mode-ux/tree'
import {
  connected,
  getUsage,
  MODELS,
  providerOf,
  PROVIDERS,
  usage,
  type Provider,
} from '../usage-display/usage'

// What the app knows about the sign-in. The app never probes (no `claude auth status` on a timer), so an expiry is
// `lapsed` until a request fails, and only then `expired`.
export type SignIn = 'ok' | 'lapsed' | 'expired' | 'signedOut'
// The vendor program: `broken` won't start, but the app only learns that when it next tries to start it.
export type Program = 'ok' | 'broken' | 'wontStart' | 'downloading'

type ProviderHealth = {
  signIn: SignIn
  program: Program
  repair: number
  // Errors from the vendor's servers (5xx, overloaded). The app only sees them as failed requests.
  outage: boolean
  // The app has seen the outage fail a request since it started.
  outageSeen: boolean
  // When the outage last refused a Prompt, which is still in the Input.
  outageRefused: number | null
  email: string
  // A crash the user hasn't dismissed: how many Replies it stopped, and whether it took a Prompt being sent.
  crashed: {at: number; stopped: number; unsent?: boolean} | null
  // The program crashes as the next Prompt is sent.
  crashNext: boolean
}

export type UpdateState =
  | {phase: 'none'}
  | {phase: 'available'}
  | {phase: 'downloading'; progress: number}
  | {phase: 'failed'; reason: 'network' | 'check'}
  | {phase: 'ready'}

export type HealthEvent = {id: number; at: number; text: string}

export type Health = {
  offline: boolean
  offlineSince: number
  // The next sign-in comes back as a different account.
  otherAccount: boolean
  // The next update download fails its signature check.
  updateFailsCheck: boolean
  // Downloading the program again doesn't fix it.
  repairFails: boolean
  providers: Record<Provider, ProviderHealth>
  update: UpdateState
  reconnect: Provider | null
  settings: null | 'Connections' | 'Updates & About'
  events: HealthEvent[]
}

// How long a vendor program keeps retrying a lost connection before the Reply fails. Real ones retry with backoff for
// a minute or more; shortened here.
export const RECONNECT_FOR = 15_000

export const VERSION = '1.4.2'
export const NEXT_VERSION = '1.5.0'

const providerHealth = (email: string): ProviderHealth => ({
  signIn: 'ok',
  program: 'ok',
  repair: 0,
  outage: false,
  outageSeen: false,
  outageRefused: null,
  email,
  crashed: null,
  crashNext: false,
})

let state: Health = {
  offline: false,
  offlineSince: 0,
  otherAccount: false,
  updateFailsCheck: false,
  repairFails: false,
  providers: {
    Claude: providerHealth('sam@example.com'),
    ChatGPT: providerHealth('sam.r@example.com'),
  },
  update: {phase: 'none'},
  reconnect: null,
  settings: null,
  events: [],
}
const listeners = new Set<() => void>()
const set = (next: Health) => {
  state = next
  for (const l of listeners) l()
}
const update = (f: (s: Health) => Health) => set(f(state))
export const useHealth = () =>
  useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
export const getHealth = () => state

let eventId = 0
const log = (text: string) =>
  update(s => ({
    ...s,
    events: [...s.events.slice(-5), {id: ++eventId, at: Date.now(), text}],
  }))

const patchProvider = (p: Provider, patch: Partial<ProviderHealth>) =>
  update(s => ({
    ...s,
    providers: {...s.providers, [p]: {...s.providers[p], ...patch}},
  }))

// ---------- derived ----------

// What stops a new Prompt to this Provider before it's sent, as far as the app knows. Lapsed sign-ins and broken
// programs aren't known until a send finds them, and an outage may be over by the next send, so they don't block.
export const blockerFor = (s: Health, p: Provider): Issue | null => {
  const ph = s.providers[p]
  if (!connected(getUsage(), p)) return null
  if (s.offline) return {kind: 'offline', provider: p}
  if (ph.program === 'wontStart' || ph.program === 'downloading')
    return {kind: 'wontStart', provider: p}
  if (ph.signIn === 'signedOut') return {kind: 'signedOut', provider: p}
  if (ph.signIn === 'expired') return {kind: 'signin', provider: p}
  return null
}

// The first Model on another Provider that would work right now.
export const alternativeTo = (s: Health, model: string) =>
  MODELS.find(
    m =>
      m.provider !== providerOf(model) &&
      connected(getUsage(), m.provider) &&
      !blockerFor(s, m.provider) &&
      s.providers[m.provider].signIn === 'ok'
  )?.name

export const needsSignIn = (s: Health, p: Provider) =>
  s.providers[p].signIn === 'expired' || s.providers[p].signIn === 'signedOut'

// Problems that concern the whole app or a whole Provider, worst first. What a variant chooses to surface globally.
export type Problem = {
  id: string
  tone: 'red' | 'amber' | 'zinc' | 'sky'
  provider?: Provider
  text: string
  detail?: string
  action?: {label: string; run: () => void}
  dismiss?: () => void
}

export function problems(s: Health): Problem[] {
  const out: Problem[] = []
  if (s.offline)
    out.push({
      id: 'offline',
      tone: 'zinc',
      text: "You're offline.",
      detail:
        'Browsing, search, Exports and Archives still work. Sending waits for the connection.',
    })
  for (const p of PROVIDERS) {
    const ph = s.providers[p]
    if (!connected(getUsage(), p)) continue
    if (ph.program === 'wontStart')
      out.push({
        id: `${p}-program`,
        tone: 'red',
        provider: p,
        text: s.repairFails
          ? `${p} still won't start on this computer.`
          : `${p} couldn't start on this computer.`,
        detail: s.repairFails
          ? 'Downloading it again didn’t help. Something on this computer may be blocking it, such as antivirus software.'
          : 'Downloading it again gets a fresh copy of the program. Your Trees aren’t touched.',
        action: s.repairFails
          ? {
              label: 'Report a problem…',
              run: () => log('Report a problem (see the bug-reporting ticket)'),
            }
          : {label: `Download ${p} again`, run: () => health.repair(p)},
      })
    if (ph.program === 'downloading')
      out.push({
        id: `${p}-program`,
        tone: 'sky',
        provider: p,
        text: `Downloading ${p}… ${Math.round(ph.repair)}%`,
      })
    if (ph.signIn === 'expired')
      out.push({
        id: `${p}-signin`,
        tone: 'amber',
        provider: p,
        text: `${p} needs you to sign in again.`,
        detail: 'Sign-ins expire every few weeks. Nothing is lost.',
        action: {label: 'Sign in again', run: () => health.openReconnect(p)},
      })
    if (ph.signIn === 'signedOut')
      out.push({
        id: `${p}-signin`,
        tone: 'zinc',
        provider: p,
        text: `You're signed out of ${p}.`,
        action: {label: 'Sign in', run: () => health.openReconnect(p)},
      })
    if (ph.outage && ph.outageSeen)
      out.push({
        id: ph.outageRefused
          ? `${p}-outage-${ph.outageRefused}`
          : `${p}-outage`,
        tone: 'amber',
        provider: p,
        text: `${p} is having trouble on its end.`,
        detail: ph.outageRefused
          ? 'It isn’t your connection or your account. Your Prompt wasn’t sent; it’s still in the Input.'
          : 'It isn’t your connection or your account. Replies may fail until it recovers.',
        action: {
          label: 'Status page ↗',
          run: () => log(`Opened ${p}'s status page in the browser`),
        },
      })
    if (ph.crashed)
      out.push({
        id: `${p}-crash`,
        tone: 'zinc',
        provider: p,
        text: `${p} stopped unexpectedly and was restarted.`,
        detail: ph.crashed.unsent
          ? 'Your Prompt wasn\u2019t sent; it\u2019s still in the Input.'
          : ph.crashed.stopped
            ? `${ph.crashed.stopped} running ${ph.crashed.stopped === 1 ? 'Reply was' : 'Replies were'} stopped; what they wrote is kept.`
            : undefined,
        dismiss: () => patchProvider(p, {crashed: null}),
      })
  }
  const u = s.update
  if (u.phase === 'failed')
    out.push({
      id: 'update',
      tone: 'zinc',
      text:
        u.reason === 'network'
          ? "The update didn't finish downloading."
          : "The update didn't pass its safety check, so it wasn't installed.",
      detail: `You're still on ${VERSION}, which keeps working.`,
      action: {label: 'Try again', run: () => health.downloadUpdate()},
      dismiss: () => update(s => ({...s, update: {phase: 'available'}})),
    })
  return out
}

// ---------- actions ----------

const failRunning = (p: Provider, issue: Issue) =>
  issueHooks.sim?.failRunning(t => providerOf(t.model) === p, issue) ?? 0

const runningOn = (p: Provider) =>
  issueHooks.sim?.running().filter(t => providerOf(t.model) === p) ?? []

let updateTimer: ReturnType<typeof setInterval> | null = null
let repairTimer: ReturnType<typeof setInterval> | null = null

export const health = {
  set: (patch: Partial<Health>) => update(s => ({...s, ...patch})),

  goOffline: () => {
    update(s => ({...s, offline: true, offlineSince: Date.now()}))
    usage.set({offline: true})
    log('Network dropped')
  },
  goOnline: () => {
    update(s => ({...s, offline: false}))
    usage.set({offline: false})
    log('Network back')
  },

  // Expires in the background; nothing shows until a request needs it.
  lapse: (p: Provider) => {
    patchProvider(p, {signIn: 'lapsed'})
    log(`${p} sign-in lapsed (the app doesn't know yet)`)
  },
  signOut: (p: Provider) => {
    const stopped = failRunning(p, {kind: 'signedOut', provider: p})
    patchProvider(p, {signIn: 'signedOut'})
    log(
      `Signed out of ${p}${stopped ? `; ${stopped} running Replies stopped` : ''}`
    )
  },
  runningOn,

  crash: (p: Provider) => {
    const stopped = failRunning(p, {kind: 'crash', provider: p})
    patchProvider(p, {crashed: {at: Date.now(), stopped}})
    log(`${p} program crashed; ${stopped} running Replies stopped`)
  },
  crashOnSend: (p: Provider) => {
    patchProvider(p, {crashNext: true})
    log(`${p} program will crash on the next send`)
  },
  breakProgram: (p: Provider) => {
    patchProvider(p, {program: 'broken'})
    log(`${p} program broken (found on next start)`)
  },
  repair: (p: Provider) => {
    if (state.offline) {
      log(`Downloading ${p} again needs a connection`)
      return
    }
    patchProvider(p, {program: 'downloading', repair: 0})
    if (repairTimer) clearInterval(repairTimer)
    repairTimer = setInterval(() => {
      const r = state.providers[p].repair + 12
      if (r < 100) return patchProvider(p, {repair: r})
      clearInterval(repairTimer!)
      repairTimer = null
      if (state.repairFails) {
        patchProvider(p, {program: 'wontStart', repair: 0})
        log(`${p} downloaded again but still won't start`)
      } else {
        patchProvider(p, {program: 'ok', repair: 0})
        log(`${p} downloaded again and starts`)
      }
    }, 300)
  },

  setOutage: (p: Provider, outage: boolean) =>
    patchProvider(
      p,
      outage ? {outage} : {outage, outageSeen: false, outageRefused: null}
    ),

  openReconnect: (p: Provider) => update(s => ({...s, reconnect: p})),
  closeReconnect: () => update(s => ({...s, reconnect: null})),
  // The sign-in flow finished. A different account just continues the same Trees.
  signedIn: (p: Provider) => {
    const other = state.otherAccount
    patchProvider(p, {
      signIn: 'ok',
      ...(other
        ? {email: p === 'Claude' ? 'robin@example.com' : 'robin.k@example.com'}
        : {}),
    })
    update(s => ({...s, reconnect: null, otherAccount: false}))
    log(`Signed in to ${p}${other ? ' as a different account' : ''}`)
  },

  openSettings: (section: Health['settings'] = 'Connections') =>
    update(s => ({...s, settings: section})),
  closeSettings: () => update(s => ({...s, settings: null})),

  offerUpdate: () => update(s => ({...s, update: {phase: 'available'}})),
  downloadUpdate: () => {
    update(s => ({...s, update: {phase: 'downloading', progress: 0}}))
    if (updateTimer) clearInterval(updateTimer)
    updateTimer = setInterval(() => {
      const u = state.update
      if (u.phase !== 'downloading') {
        clearInterval(updateTimer!)
        return
      }
      if (state.offline) {
        clearInterval(updateTimer!)
        update(s => ({...s, update: {phase: 'failed', reason: 'network'}}))
        log('Update download failed: connection lost')
        return
      }
      const progress = u.progress + 9
      if (progress < 100)
        return update(s => ({...s, update: {phase: 'downloading', progress}}))
      clearInterval(updateTimer!)
      if (state.updateFailsCheck) {
        update(s => ({
          ...s,
          update: {phase: 'failed', reason: 'check'},
          updateFailsCheck: false,
        }))
        log('Update failed its signature check and was discarded')
      } else update(s => ({...s, update: {phase: 'ready'}}))
    }, 250)
  },
  restartToUpdate: () => {
    update(s => ({...s, update: {phase: 'none'}}))
    log(`Restarted into ${NEXT_VERSION} (prototype: nothing changes)`)
  },
  log,
}

// ---------- wiring into the Tree sim ----------

// A Prompt the Provider refuses before anything happens (offline, sign-in, the program, an outage) never joins the
// Tree: the Input keeps it and the app shows why. The app only finds out about a lapsed sign-in or a broken program here.
issueHooks.preflight = (model, retrying) => {
  const p = providerOf(model)
  const s = state
  if (!connected(getUsage(), p)) return null
  const known = blockerFor(s, p)
  if (known) return known
  const ph = s.providers[p]
  if (ph.crashNext) {
    patchProvider(p, {
      crashNext: false,
      crashed: {
        at: Date.now(),
        stopped: failRunning(p, {kind: 'crash', provider: p}),
        unsent: !retrying,
      },
    })
    log(
      retrying
        ? `${p} program crashed while retrying`
        : `${p} program crashed while sending; the Prompt stays in the Input`
    )
    return {kind: 'crash', provider: p}
  }
  if (ph.program === 'broken') {
    patchProvider(p, {program: 'wontStart'})
    log(`${p} program wouldn't start; the Prompt stays in the Input`)
    return {kind: 'wontStart', provider: p}
  }
  if (ph.signIn === 'lapsed') {
    patchProvider(p, {signIn: 'expired'})
    log(`${p} said "login expired"; the Prompt stays in the Input`)
    return {kind: 'signin', provider: p}
  }
  if (ph.outage) {
    patchProvider(p, {
      outageSeen: true,
      ...(retrying ? {} : {outageRefused: Date.now()}),
    })
    log(
      retrying
        ? `${p} refused the retry: trouble on its end`
        : `${p} refused the Prompt: trouble on its end; it stays in the Input`
    )
    return {kind: 'outage', provider: p}
  }
  if (retrying) return null
  // The Prompt a crash or an outage held back has now gone through.
  for (const q of PROVIDERS) {
    const qh = state.providers[q]
    if (qh.crashed?.unsent) patchProvider(q, {crashed: null})
    if (qh.outageRefused) patchProvider(q, {outageRefused: null})
  }
  return null
}

// Running Replies: a lost connection pauses them while the vendor program retries, then fails them; an expired
// sign-in or an outage fails them at their next request.
const pausedAt: Record<string, number> = {}
issueHooks.check = (t: Turn) => {
  const p = providerOf(t.model)
  const s = state
  if (s.offline) {
    const since = (pausedAt[t.id] ??= Date.now())
    if (Date.now() - since < RECONNECT_FOR) return 'pause'
    delete pausedAt[t.id]
    return {kind: 'offline', provider: p}
  }
  delete pausedAt[t.id]
  const ph = s.providers[p]
  // Each running Reply makes its next request at some point; a few percent per tick gets there within a few seconds.
  if (Math.random() > 0.04) return null
  if (ph.signIn === 'lapsed' || ph.signIn === 'expired') {
    if (ph.signIn === 'lapsed') {
      patchProvider(p, {signIn: 'expired'})
      log(`${p} said "login expired" mid-Reply`)
    }
    return {kind: 'signin', provider: p}
  }
  if (ph.outage) {
    patchProvider(p, {outageSeen: true})
    return {kind: 'outage', provider: p}
  }
  return null
}
