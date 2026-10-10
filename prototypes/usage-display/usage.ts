// PROTOTYPE: fake account-wide usage for the Usage and limit display ticket (#36). One store for the whole app, since a
// Provider's limits are per account, not per Tree or Thread. Sim clock, in memory. Throw away.
import {useSyncExternalStore} from 'react'

import {usageHooks, type LimitInfo, type Turn} from '../canvas-mode-ux/tree'

export type Provider = 'Claude' | 'ChatGPT'
export const PROVIDERS: Provider[] = ['Claude', 'ChatGPT']

export const MODELS: {name: string; provider: Provider}[] = [
  {name: 'Claude Sonnet 5', provider: 'Claude'},
  {name: 'Claude Opus 5', provider: 'Claude'},
  {name: 'Claude Fable 5', provider: 'Claude'},
  {name: 'Claude Haiku 5', provider: 'Claude'},
  {name: 'GPT-5.5', provider: 'ChatGPT'},
  {name: 'GPT-5.5 mini', provider: 'ChatGPT'},
]
export const providerOf = (model?: string): Provider =>
  model?.startsWith('GPT') ? 'ChatGPT' : 'Claude'

// One window as the Provider reports it. `model`: a per-model weekly (Claude Max's Fable), which only limits that Model.
export type Win = {
  id: string
  minutes: number
  percent: number
  resetsAt: number
  model?: string
}

const H = 60
const DAY = 24 * H
const WEEK = 7 * DAY

type Plan = {label: string; windows: Omit<Win, 'percent' | 'resetsAt'>[]}
export const PLANS: Record<Provider, Record<string, Plan>> = {
  Claude: {
    none: {label: 'Not connected', windows: []},
    pro: {
      label: 'Pro',
      windows: [
        {id: '5h', minutes: 5 * H},
        {id: '7d', minutes: WEEK},
      ],
    },
    max: {
      label: 'Max',
      windows: [
        {id: '5h', minutes: 5 * H},
        {id: '7d', minutes: WEEK},
        {id: 'fable', minutes: WEEK, model: 'Claude Fable 5'},
      ],
    },
  },
  ChatGPT: {
    none: {label: 'Not connected', windows: []},
    plus: {label: 'Plus', windows: [{id: 'primary', minutes: WEEK}]},
    pro: {label: 'Pro', windows: [{id: 'primary', minutes: WEEK}]},
    plus5h: {
      label: 'Plus (if it ever sends a 5-hour window too)',
      windows: [
        {id: 'primary', minutes: 5 * H},
        {id: 'secondary', minutes: WEEK},
      ],
    },
    flexible: {label: 'Business, flexible (no windows)', windows: []},
  },
}

// Named from the duration, like Codex's own TUI does.
export const windowName = (w: Win) =>
  w.model
    ? `${w.model.replace(/^Claude /, '').replace(/ \d+$/, '')} weekly`
    : w.minutes <= 5 * H + 5
      ? '5-hour'
      : w.minutes <= DAY + 5
        ? 'Daily'
        : w.minutes <= WEEK + 5
          ? 'Weekly'
          : 'Monthly'

// Percent each new Reply costs, by window length; a stand-in for real usage.
const cost = (w: Win) => (w.model ? 6 : w.minutes <= 5 * H ? 9 : 3)

export const WARN_AT = 80

type ProviderState = {
  plan: string
  // What the Provider's servers know. Usage outside the app (claude.ai, ChatGPT's apps) lands here first.
  truth: Win[]
  // What the app last read or was told during a Turn.
  shown: Win[]
  updatedAt: number
  // Claude: the last figure came from a Reply's `rate_limit_event`, not an on-demand read.
  fromReply: boolean
  credits: boolean
}

export type UsageEvent = {
  id: number
  kind: 'hit' | 'back' | 'credits'
  provider: Provider
  at: number
  window?: string
  // Running Replies the limit refused.
  failed?: number
}

export type UsageState = {
  now: number
  model: string
  providers: Record<Provider, ProviderState>
  // Claude's experimental on-demand read is gone (removed in an update).
  claudeReadGone: boolean
  offline: boolean
  // Running Claude Replies make another request (tools, Subagents) and are refused by a limit reached meanwhile.
  claudeRunningFail: boolean
  settingsOpen: boolean
  events: UsageEvent[]
}

const start = Date.now()
const at = (minutes: number) => start + minutes * 60_000

const seedWindows = (provider: Provider, plan: string): Win[] => {
  const seeds: Record<string, [number, number]> = {
    'Claude 5h': [34, 2 * H + 10],
    'Claude 7d': [41, 3 * DAY + 5 * H],
    'Claude fable': [12, 3 * DAY + 5 * H],
    'ChatGPT primary': [58, 4 * DAY + 2 * H],
    'ChatGPT secondary': [58, 4 * DAY + 2 * H],
  }
  return PLANS[provider][plan]!.windows.map(w => {
    const [percent, mins] = seeds[`${provider} ${w.id}`] ?? [20, w.minutes / 2]
    const p = provider === 'ChatGPT' && w.minutes <= 5 * H ? 22 : percent
    return {
      ...w,
      percent: p,
      resetsAt: at(w.minutes <= 5 * H ? 2 * H + 10 : mins),
    }
  })
}

const providerState = (provider: Provider, plan: string): ProviderState => {
  const w = seedWindows(provider, plan)
  return {
    plan,
    truth: w,
    shown: w.map(x => ({...x})),
    updatedAt: at(-2),
    fromReply: false,
    credits: false,
  }
}

let state: UsageState = {
  now: start,
  model: 'Claude Sonnet 5',
  providers: {
    Claude: providerState('Claude', 'max'),
    ChatGPT: providerState('ChatGPT', 'plus'),
  },
  claudeReadGone: false,
  offline: false,
  claudeRunningFail: true,
  settingsOpen: false,
  events: [],
}
const listeners = new Set<() => void>()
const set = (next: UsageState) => {
  state = next
  for (const l of listeners) l()
}
const update = (f: (s: UsageState) => UsageState) => set(f(state))
export const useUsage = () =>
  useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
export const getUsage = () => state

let eventId = 0
const withEvent = (s: UsageState, e: Omit<UsageEvent, 'id' | 'at'>) => ({
  ...s,
  events: [...s.events, {...e, id: ++eventId, at: s.now}],
})

// ---------- derived ----------

export const connected = (s: UsageState, p: Provider) =>
  s.providers[p].plan !== 'none'

// What the UI shows for a Provider: without the on-demand read, Claude's per-model weeklies never arrive.
export const shownWindows = (s: UsageState, p: Provider) =>
  s.providers[p].shown.filter(
    w => !(p === 'Claude' && s.claudeReadGone && w.model)
  )

// Windows that limit a Model: the Provider-wide ones plus its own per-model weekly.
export const windowsFor = (wins: Win[], model: string) =>
  wins.filter(w => !w.model || w.model === model)

export const limitFor = (
  s: UsageState,
  model: string,
  wins = s.providers[providerOf(model)].truth
): LimitInfo | null => {
  const p = providerOf(model)
  if (!connected(s, p)) return null
  const full = windowsFor(wins, model).filter(w => w.percent >= 100)
  if (!full.length) return null
  const last = full.reduce((a, b) => (b.resetsAt > a.resetsAt ? b : a))
  return {provider: p, window: windowName(last), until: last.resetsAt}
}

// Limited and not covered by usage credits.
export const blockedFor = (s: UsageState, model: string) =>
  s.providers[providerOf(model)].credits ? null : limitFor(s, model)

export const onCredits = (s: UsageState, model: string) =>
  s.providers[providerOf(model)].credits && !!limitFor(s, model)

// The tightest window for a Model: the one nearest its limit.
export const tightest = (s: UsageState, model: string) =>
  windowsFor(shownWindows(s, providerOf(model)), model).reduce<Win | null>(
    (a, b) => (!a || b.percent > a.percent ? b : a),
    null
  )

export const level = (percent: number) =>
  percent >= 100 ? 'limit' : percent >= WARN_AT ? 'warn' : 'ok'

// ---------- time ----------

export const clock = (t: number) =>
  new Date(t)
    .toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})
    .replace(' ', '')
    .toLowerCase()

export const resetText = (t: number, now: number) => {
  const d = new Date(t)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  const tomorrow =
    new Date(now + DAY * 60_000).toDateString() === d.toDateString()
  return sameDay
    ? clock(t)
    : tomorrow
      ? `tomorrow ${clock(t)}`
      : `${d.toLocaleDateString('en-US', {weekday: 'short'})} ${clock(t)}`
}

export const until = (t: number, now: number) => {
  const m = Math.max(0, Math.round((t - now) / 60_000))
  if (m < 60) return `${m} min`
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`
  return `${Math.round(m / 60 / 24)} days`
}

export const ago = (t: number, now: number) => {
  const m = Math.round((now - t) / 60_000)
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : `${Math.floor(m / 60)} h ago`
}

// ---------- actions ----------

const READ_EVERY = 5 * 60_000

const tickProvider = (s: UsageState, p: Provider): [ProviderState, boolean] => {
  const ps = s.providers[p]
  let changed = false
  const roll = (w: Win) => {
    if (s.now < w.resetsAt) return w
    changed = true
    let resetsAt = w.resetsAt
    while (resetsAt <= s.now) resetsAt += w.minutes * 60_000
    return {...w, percent: 0, resetsAt}
  }
  const truth = ps.truth.map(roll)
  // A reset time is known, so the shown figure rolls over on time even without a read.
  const shown = ps.shown.map(roll)
  return [changed ? {...ps, truth, shown} : ps, changed]
}

// Reads on demand: on open, on connect, every 5 minutes, and from Refresh. Offline or (for Claude) without the
// experimental read, nothing changes and the figure goes stale.
const read = (s: UsageState, p: Provider, force = false): UsageState => {
  const ps = s.providers[p]
  if (!connected(s, p) || s.offline) return s
  if (p === 'Claude' && s.claudeReadGone) return s
  if (!force && s.now - ps.updatedAt < READ_EVERY) return s
  return {
    ...s,
    providers: {
      ...s.providers,
      [p]: {
        ...ps,
        shown: ps.truth.map(w => ({...w})),
        updatedAt: s.now,
        fromReply: false,
      },
    },
  }
}

const tick = (ms: number) =>
  update(s0 => {
    let s = {...s0, now: s0.now + ms}
    for (const p of PROVIDERS) {
      const before = limitFor(
        s0,
        p === 'Claude' ? 'Claude Sonnet 5' : 'GPT-5.5'
      )
      const [ps, changed] = tickProvider(s, p)
      if (changed) s = {...s, providers: {...s.providers, [p]: ps}}
      s = read(s, p)
      const after = limitFor(s, p === 'Claude' ? 'Claude Sonnet 5' : 'GPT-5.5')
      if (before && !after) s = withEvent(s, {kind: 'back', provider: p})
    }
    return s
  })

setInterval(() => tick(1000), 1000)

export const usage = {
  skip: (minutes: number) => tick(minutes * 60_000),
  // Jumps to the next moment a full window resets.
  skipToReset: () => {
    const s = getUsage()
    const times = PROVIDERS.flatMap(p =>
      s.providers[p].truth.filter(w => w.percent >= 100).map(w => w.resetsAt)
    )
    if (times.length) tick(Math.min(...times) - s.now + 1000)
  },
  refresh: (p: Provider) => update(s => read(s, p, true)),
  setModel: (model: string) => update(s => ({...s, model})),
  setPlan: (p: Provider, plan: string) =>
    update(s => {
      const next = {
        ...s,
        providers: {...s.providers, [p]: providerState(p, plan)},
      }
      next.providers[p].updatedAt = s.now
      // Keep the picked Model usable.
      if (plan === 'none' && providerOf(s.model) === p) {
        const other = MODELS.find(m => m.provider !== p)!
        if (connected(next, other.provider)) next.model = other.name
      }
      return next
    }),
  // Sets a window's real figure; `shown` too, as if just read.
  setPercent: (p: Provider, id: string, percent: number) =>
    update(s => {
      const ps = s.providers[p]
      const f = (w: Win) => (w.id === id ? {...w, percent} : w)
      return {
        ...s,
        providers: {
          ...s.providers,
          [p]: {
            ...ps,
            truth: ps.truth.map(f),
            shown: ps.shown.map(f),
            updatedAt: s.now,
          },
        },
      }
    }),
  // Usage outside the app; the app only learns of it from the next read or Turn.
  useElsewhere: (p: Provider, points: number) =>
    update(s => {
      const ps = s.providers[p]
      return {
        ...s,
        providers: {
          ...s.providers,
          [p]: {
            ...ps,
            truth: ps.truth.map(w => ({
              ...w,
              percent: Math.min(100, w.percent + points),
            })),
          },
        },
      }
    }),
  hitLimit: (p: Provider) => {
    const s = getUsage()
    const ps = s.providers[p]
    const w = ps.truth.find(w => !w.model)
    if (!w) return
    usage.setPercent(p, w.id, 100)
    afterLimit(p, w)
  },
  set: (patch: Partial<UsageState>) => update(s => ({...s, ...patch})),
  setCredits: (p: Provider, credits: boolean) =>
    update(s => ({
      ...s,
      providers: {...s.providers, [p]: {...s.providers[p], credits}},
    })),
  openSettings: () => update(s => ({...s, settingsOpen: true})),
  closeSettings: () => update(s => ({...s, settingsOpen: false})),
}

// A window just filled: running Replies on it that make another request are refused (Claude, if they use tools or
// Subagents); Codex lets a running Turn finish. Every Thread on that Provider is limited from now on.
function afterLimit(p: Provider, w: Win) {
  const s = getUsage()
  if (s.providers[p].credits) {
    update(s => withEvent(s, {kind: 'credits', provider: p}))
    return
  }
  const info: LimitInfo = {
    provider: p,
    window: windowName(w),
    until: w.resetsAt,
  }
  const failed =
    p === 'Claude' && s.claudeRunningFail && usageHooks.sim
      ? usageHooks.sim.failRunning(
          (t: Turn) =>
            providerOf(t.model) === p && (!w.model || t.model === w.model),
          info
        )
      : 0
  update(s =>
    withEvent(s, {kind: 'hit', provider: p, window: windowName(w), failed})
  )
}

// ---------- wiring into the Tree sim ----------

usageHooks.gate = model => {
  const s = getUsage()
  const block = blockedFor(s, model)
  if (block) {
    // A refused request brings the real figure with it (`rate_limit_event` / `account/rateLimits/updated`).
    const p = providerOf(model)
    update(s => ({
      ...s,
      providers: {
        ...s.providers,
        [p]: {
          ...s.providers[p],
          shown: s.providers[p].truth.map(w => ({...w})),
        },
      },
    }))
  }
  return block
}

usageHooks.started = model => {
  const p = providerOf(model)
  const s = getUsage()
  if (!connected(s, p)) return
  const ps = s.providers[p]
  const filled: Win[] = []
  const truth = ps.truth.map(w => {
    if (w.model && w.model !== model) return w
    const percent = Math.min(100, w.percent + cost(w))
    if (percent >= 100 && w.percent < 100) filled.push(w)
    return {...w, percent}
  })
  // The push during a Turn: Claude's carries only the 5-hour and 7-day windows; Codex's carries them all.
  const shown = truth.map(w => {
    const old = ps.shown.find(x => x.id === w.id)
    return p === 'Claude' && w.model && old ? old : {...w}
  })
  update(s => ({
    ...s,
    providers: {
      ...s.providers,
      [p]: {
        ...ps,
        truth,
        shown,
        updatedAt: s.now,
        fromReply: p === 'Claude' && s.claudeReadGone,
      },
    },
  }))
  for (const w of filled) afterLimit(p, {...w, percent: 100})
}

// Mirror the Model pick into the sim's next Prompt.
listeners.add(() => {
  usageHooks.model = state.model
})
usageHooks.model = state.model
