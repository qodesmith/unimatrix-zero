import type {TreeSim} from '../canvas-mode-ux/tree'

// PROTOTYPE: pieces shared by the usage variants: Model pill, meters, the per-Provider usage card (Settings →
// Connections in every variant), the Settings dialog, and the debug panel. Throw away.
import {useEffect, useRef, useState} from 'react'

import {useSim} from '../canvas-mode-ux/shared'
import {spreadReplies, type Turn} from '../canvas-mode-ux/tree'
import {
  ago,
  blockedFor,
  connected,
  level,
  MODELS,
  onCredits,
  PLANS,
  providerOf,
  PROVIDERS,
  resetText,
  shownWindows,
  until,
  usage,
  useUsage,
  windowName,
  windowsFor,
  type Provider,
  type Win,
} from './usage'

export const ICON: Record<Provider, string> = {Claude: '✳', ChatGPT: '◎'}
const EMAIL: Record<Provider, string> = {
  Claude: 'sam@example.com',
  ChatGPT: 'sam.r@example.com',
}

export const tone = (percent: number) =>
  ({ok: 'bg-zinc-400', warn: 'bg-amber-500', limit: 'bg-red-500'})[
    level(percent)
  ]
export const text = (percent: number) =>
  ({ok: 'text-zinc-500', warn: 'text-amber-700', limit: 'text-red-700'})[
    level(percent)
  ]

export function Bar({
  percent,
  className = 'h-1.5',
}: {
  percent: number
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-full bg-zinc-200 ${className}`}>
      <div
        className={`h-full ${tone(percent)}`}
        style={{width: `${Math.min(100, percent)}%`}}
      />
    </div>
  )
}

// A small ring for tight spaces.
export function Ring({percent, size = 14}: {percent: number; size?: number}) {
  const r = 5
  const c = 2 * Math.PI * r
  const color = {ok: '#71717a', warn: '#d97706', limit: '#dc2626'}[
    level(percent)
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0">
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="#e4e4e7"
        strokeWidth="2.5"
      />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={`${(Math.min(100, percent) / 100) * c} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

// Closes on outside click or Esc.
export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return {open, setOpen, ref}
}

// The Model a Prompt goes to. Global in the prototype; per Prompt in the real app.
export function ModelPill({showProvider = true}: {showProvider?: boolean}) {
  const s = useUsage()
  const pop = usePopover()
  return (
    <div ref={pop.ref} className="relative">
      <button
        onClick={() => pop.setOpen(o => !o)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-100"
      >
        {showProvider && <span>{ICON[providerOf(s.model)]}</span>}
        {s.model}
        <span className="text-zinc-400">▾</span>
      </button>
      {pop.open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          {PROVIDERS.map(p => (
            <div key={p}>
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
                {ICON[p]} {p}
                {!connected(s, p) && ' · not connected'}
              </div>
              {MODELS.filter(m => m.provider === p).map(m => {
                const blocked = blockedFor(s, m.name)
                return (
                  <button
                    key={m.name}
                    disabled={!connected(s, p)}
                    onClick={() => {
                      usage.setModel(m.name)
                      pop.setOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 disabled:opacity-40 ${m.name === s.model ? 'font-medium' : ''}`}
                  >
                    {m.name}
                    {blocked && (
                      <span className="text-[10px] text-red-600">
                        until {resetText(blocked.until, s.now)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function WindowRow({
  w,
  now,
  dense,
}: {
  w: Win
  now: number
  dense?: boolean
}) {
  return (
    <div className={dense ? 'py-0.5' : 'py-1'}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-zinc-700">{windowName(w)}</span>
        <span className={text(w.percent)}>
          {w.percent >= 100 ? 'Limit reached' : `${Math.round(w.percent)}%`}
        </span>
      </div>
      <Bar
        percent={w.percent}
        className={dense ? 'mt-0.5 h-1' : 'mt-1 h-1.5'}
      />
      {!dense && (
        <div className="mt-0.5 text-[10px] text-zinc-400">
          Resets {resetText(w.resetsAt, now)} · in {until(w.resetsAt, now)}
        </div>
      )}
    </div>
  )
}

// How fresh the figure is, and the Refresh button.
export function Freshness({p}: {p: Provider}) {
  const s = useUsage()
  const ps = s.providers[p]
  const noRead = p === 'Claude' && s.claudeReadGone
  const stale = s.now - ps.updatedAt > 10 * 60_000
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
      <span className={stale ? 'text-amber-700' : ''}>
        {noRead
          ? `From your last Reply, ${ago(ps.updatedAt, s.now)}`
          : s.offline
            ? `Couldn't refresh · updated ${ago(ps.updatedAt, s.now)}`
            : `Updated ${ago(ps.updatedAt, s.now)}`}
      </span>
      {!noRead && (
        <button
          onClick={() => usage.refresh(p)}
          title="Refresh"
          className="hover:text-zinc-900"
        >
          ⟳
        </button>
      )}
    </div>
  )
}

// The full picture for one Provider: every window it reports, with reset times.
export function UsageDetails({p}: {p: Provider}) {
  const s = useUsage()
  const ps = s.providers[p]
  const wins = shownWindows(s, p)
  const model = MODELS.find(m => m.provider === p)!.name
  const blocked = blockedFor(s, model)
  return (
    <div>
      {blocked && (
        <div className="mb-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-800">
          {p}'s {blocked.window.toLowerCase()} limit is reached. Back at{' '}
          {resetText(blocked.until, s.now)} (in {until(blocked.until, s.now)}).
        </div>
      )}
      {onCredits(s, model) && (
        <div className="mb-2 rounded-md bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
          Plan limit reached; Replies now use your usage credits.
        </div>
      )}
      {wins.length ? (
        wins.map(w => <WindowRow key={w.id} w={w} now={s.now} />)
      ) : (
        <div className="py-1 text-[11px] text-zinc-500">
          {p} doesn't report any limits for this plan.
        </div>
      )}
      {p === 'Claude' && s.claudeReadGone && ps.plan === 'max' && (
        <div className="py-1 text-[10px] text-zinc-400">
          Per-model weeklies (Fable) can't be shown right now.
        </div>
      )}
      <div className="mt-1">
        <Freshness p={p} />
      </div>
    </div>
  )
}

const SECTIONS = [
  'Appearance',
  'Chat',
  'System prompts',
  'Tools',
  'Connections',
  'Storage',
  'Archive & restore',
  'Updates & About',
]

export function SettingsModal() {
  const s = useUsage()
  if (!s.settingsOpen) return null
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30"
      onClick={usage.closeSettings}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex h-[560px] w-[760px] overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 text-sm">
          <div className="mb-2 px-2 font-semibold">Settings</div>
          {SECTIONS.map(x => (
            <div
              key={x}
              className={`rounded-md px-2 py-1 ${x === 'Connections' ? 'bg-zinc-200 font-medium' : 'text-zinc-400'}`}
            >
              {x}
            </div>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-semibold">Connections</h2>
            <button
              onClick={usage.closeSettings}
              className="text-zinc-400 hover:text-zinc-900"
            >
              ✕
            </button>
          </div>
          <p className="mb-4 text-xs text-zinc-500">
            Usage is shared with everything else on the same account (claude.ai,
            the ChatGPT apps, and so on).
          </p>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map(p => {
              const ps = s.providers[p]
              return (
                <div key={p} className="rounded-xl border border-zinc-200 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {ICON[p]} {p}
                  </div>
                  {connected(s, p) ? (
                    <>
                      <div className="mb-2 text-[11px] text-zinc-500">
                        {EMAIL[p]} · {PLANS[p][ps.plan]!.label}
                      </div>
                      <UsageDetails p={p} />
                      <button className="mt-3 text-[11px] text-zinc-500 underline">
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button className="mt-2 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white">
                      Connect
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// The default status for a refused Reply: what happened, when it's back, Retry once it is.
export function LimitStatus({reply, sim}: {reply: Turn; sim: TreeSim}) {
  const s = useUsage()
  const still = blockedFor(s, reply.model!)
  return (
    <span className="flex items-center gap-2 text-[11px] text-red-700">
      {still
        ? `Usage limit reached · back at ${resetText(still.until, s.now)}`
        : 'Usage limit reached'}
      <button
        disabled={!!still}
        onClick={() => sim.retry(reply.id)}
        className="nodrag rounded-md bg-red-600 px-2 py-0.5 text-white hover:bg-red-500 disabled:bg-zinc-300"
      >
        ↻ Retry
      </button>
    </span>
  )
}

// ---------- prototype chrome ----------

export function UsageDebug({question}: {question: string}) {
  const s = useUsage()
  const sim = useSim()
  const [open, setOpen] = useState(true)
  const streaming = Object.values(sim.tree).filter(
    t => t.status === 'streaming'
  )
  const spread = spreadReplies(sim.tree, 3)
  const btn =
    'rounded border border-fuchsia-400 px-1.5 py-0.5 hover:bg-fuchsia-100 disabled:opacity-40'
  return (
    <div className="fixed top-12 right-3 z-[60] w-72 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-2.5 font-mono text-[11px] text-fuchsia-950 shadow">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full justify-between font-bold"
      >
        PROTOTYPE · Usage <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-[80vh] space-y-2 overflow-y-auto">
          <div className="text-fuchsia-700">{question}</div>
          <div>
            Clock{' '}
            {new Date(s.now).toLocaleString('en-US', {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
            <div className="mt-1 flex flex-wrap gap-1">
              <button className={btn} onClick={() => usage.skip(30)}>
                +30 min
              </button>
              <button className={btn} onClick={() => usage.skip(5 * 60)}>
                +5 h
              </button>
              <button className={btn} onClick={usage.skipToReset}>
                To next reset
              </button>
            </div>
          </div>
          {PROVIDERS.map(p => {
            const ps = s.providers[p]
            return (
              <div key={p} className="border-t border-fuchsia-200 pt-1.5">
                <div className="flex items-center gap-1">
                  <b>{p}</b>
                  <select
                    value={ps.plan}
                    onChange={e => usage.setPlan(p, e.target.value)}
                    className="ml-auto max-w-40 rounded border border-fuchsia-300 bg-white"
                  >
                    {Object.entries(PLANS[p]).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                {ps.truth.map(w => {
                  const shown = ps.shown.find(x => x.id === w.id)
                  return (
                    <label key={w.id} className="mt-1 flex items-center gap-1">
                      <span className="w-20 truncate">{windowName(w)}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={w.percent}
                        onChange={e =>
                          usage.setPercent(p, w.id, +e.target.value)
                        }
                        className="flex-1 accent-fuchsia-700"
                      />
                      <span className="w-14 text-right">
                        {Math.round(w.percent)}
                        {shown && shown.percent !== w.percent
                          ? `/${Math.round(shown.percent)}`
                          : ''}
                        %
                      </span>
                    </label>
                  )
                })}
                {connected(s, p) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      className={btn}
                      onClick={() => usage.hitLimit(p)}
                      disabled={!ps.truth.length}
                    >
                      Hit the limit now
                    </button>
                    <button
                      className={btn}
                      onClick={() => usage.useElsewhere(p, 20)}
                      disabled={!ps.truth.length}
                    >
                      +20% used elsewhere
                    </button>
                  </div>
                )}
                {p === 'Claude' && (
                  <label className="mt-1 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={ps.credits}
                      onChange={e => usage.setCredits(p, e.target.checked)}
                    />
                    Usage credits on (keeps going past the limit)
                  </label>
                )}
              </div>
            )
          })}
          <div className="space-y-1 border-t border-fuchsia-200 pt-1.5">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.claudeReadGone}
                onChange={e => usage.set({claudeReadGone: e.target.checked})}
              />
              Claude's experimental read is gone
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.offline}
                onChange={e => usage.set({offline: e.target.checked})}
              />
              Offline (reads fail, figures go stale)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.claudeRunningFail}
                onChange={e => usage.set({claudeRunningFail: e.target.checked})}
              />
              Running Claude Replies get refused at the limit (tools, Subagents)
            </label>
          </div>
          <div className="border-t border-fuchsia-200 pt-1.5">
            Streaming:{' '}
            {streaming.length ? streaming.map(t => t.model).join(', ') : 'none'}
            <button
              className={`${btn} mt-1 block`}
              disabled={!spread.length}
              onClick={() =>
                spread.forEach(id =>
                  sim.submit(id, 'Quick one: anything to add?')
                )
              }
            >
              Start 3 Replies at once ({s.model})
            </button>
          </div>
          <div className="border-t border-fuchsia-200 pt-1.5 text-fuchsia-700">
            {s.events.slice(-3).map(e => (
              <div key={e.id}>
                {resetText(e.at, s.now)} {e.provider} {e.kind}
                {e.failed ? ` (${e.failed} running refused)` : ''}
              </div>
            ))}
            {!s.events.length && 'No limit events yet'}
            <div className="mt-1">
              Slider: real %, then /shown % when the app's figure is behind.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
