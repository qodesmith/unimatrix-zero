// PROTOTYPE variant C: quiet until it matters. No figure anywhere day to day; a band across the top of the canvas
// appears at a warning, at the limit, and when it's back. The full picture is in Settings → Connections. Throw away.
import {useState} from 'react'

import {useSim, type UsageUi} from '../canvas-mode-ux/shared'
import {ICON, LimitStatus, ModelPill} from './common'
import {
  blockedFor,
  connected,
  MODELS,
  onCredits,
  PROVIDERS,
  providerOf,
  resetText,
  shownWindows,
  until,
  usage,
  useUsage,
  WARN_AT,
  windowName,
  windowsFor,
  type Provider,
} from './usage'

export const name = 'Quiet until it matters'

const BACK_SHOWN_FOR = 30 * 60_000

function Band({
  tone,
  children,
  onClose,
}: {
  tone: string
  children: React.ReactNode
  onClose?: () => void
}) {
  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-1.5 text-xs ${tone}`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {children}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          title="Dismiss"
          className="opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  )
}

const link = 'underline underline-offset-2 hover:opacity-80'

function Banner() {
  const s = useUsage()
  const sim = useSim()
  const [dismissed, setDismissed] = useState<string[]>([])
  const bands: React.ReactNode[] = []
  for (const p of PROVIDERS as Provider[]) {
    if (!connected(s, p)) continue
    // Warnings and limits for the picked Model on its own Provider; Provider-wide ones elsewhere.
    const model =
      providerOf(s.model) === p
        ? s.model
        : MODELS.find(m => m.provider === p)!.name
    const blocked = blockedFor(s, model)
    const other = MODELS.find(
      m =>
        m.provider !== p && connected(s, m.provider) && !blockedFor(s, m.name)
    )
    const hit = [...s.events]
      .reverse()
      .find(e => e.provider === p && e.kind === 'hit')
    if (blocked) {
      bands.push(
        <Band key={p} tone="border-red-200 bg-red-50 text-red-900">
          <span>
            <b>
              {ICON[p]} {p}'s {blocked.window.toLowerCase()} limit is reached.
            </b>{' '}
            Every {p} Thread waits until {resetText(blocked.until, s.now)} (in{' '}
            {until(blocked.until, s.now)}).
            {hit?.failed
              ? ` ${hit.failed} running ${hit.failed === 1 ? 'Reply was' : 'Replies were'} stopped by it.`
              : ''}
          </span>
          {other && providerOf(s.model) === p && (
            <button className={link} onClick={() => usage.setModel(other.name)}>
              Switch to {other.name}
            </button>
          )}
          <button className={link} onClick={usage.openSettings}>
            Details
          </button>
        </Band>
      )
      continue
    }
    if (onCredits(s, model)) {
      bands.push(
        <Band key={p} tone="border-violet-200 bg-violet-50 text-violet-900">
          <span>
            {ICON[p]} {p}'s plan limit is reached; Replies now use your usage
            credits.
          </span>
          <button className={link} onClick={usage.openSettings}>
            Details
          </button>
        </Band>
      )
      continue
    }
    const back = [...s.events]
      .reverse()
      .find(e => e.provider === p && e.kind === 'back')
    if (
      back &&
      s.now - back.at < BACK_SHOWN_FOR &&
      !dismissed.includes(`back-${back.id}`)
    ) {
      const refused = Object.values(sim.tree).filter(
        t => t.limit && t.status === 'failed' && providerOf(t.model) === p
      )
      bands.push(
        <Band
          key={p}
          tone="border-emerald-200 bg-emerald-50 text-emerald-900"
          onClose={() => setDismissed(d => [...d, `back-${back.id}`])}
        >
          <span>
            {ICON[p]} {p} is available again.
          </span>
          {refused.length > 0 && (
            <button
              className={link}
              onClick={() => refused.forEach(t => sim.retry(t.id))}
            >
              Retry {refused.length} stopped{' '}
              {refused.length === 1 ? 'Reply' : 'Replies'}
            </button>
          )}
        </Band>
      )
      continue
    }
    const warn = windowsFor(shownWindows(s, p), model)
      .filter(w => w.percent >= WARN_AT)
      .sort((a, b) => b.percent - a.percent)[0]
    // Dismissing hides it until the next 10 points.
    const key = warn && `warn-${p}-${warn.id}-${Math.floor(warn.percent / 10)}`
    if (warn && !dismissed.includes(key!))
      bands.push(
        <Band
          key={p}
          tone="border-amber-200 bg-amber-50 text-amber-900"
          onClose={() => setDismissed(d => [...d, key!])}
        >
          <span>
            {ICON[p]} You've used {Math.round(warn.percent)}% of {p}'s{' '}
            {windowName(warn).toLowerCase()} limit. It resets{' '}
            {resetText(warn.resetsAt, s.now)}.
          </span>
          <button className={link} onClick={usage.openSettings}>
            Details
          </button>
        </Band>
      )
  }
  return bands.length ? <div className="relative z-40">{bands}</div> : null
}

function Above() {
  const s = useUsage()
  const blocked = blockedFor(s, s.model)
  if (!blocked) return null
  return (
    <div className="mb-1 text-[11px] text-zinc-500">
      Waiting for {blocked.provider} · {resetText(blocked.until, s.now)}
    </div>
  )
}

export function useUi(): UsageUi {
  const s = useUsage()
  return {
    Toolbar: ModelPill,
    Above,
    blocked: !!blockedFor(s, s.model),
    LimitStatus,
    Banner,
    openSettings: usage.openSettings,
  }
}
