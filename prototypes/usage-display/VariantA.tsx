// PROTOTYPE variant A: a usage meter always at the bottom of the sidebar, every window each Provider reports, like a
// battery indicator. The Input only speaks up when its Model can't be used. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'

import {Bar, Freshness, ICON, LimitStatus, ModelPill, text} from './common'
import {
  blockedFor,
  connected,
  MODELS,
  onCredits,
  PLANS,
  PROVIDERS,
  providerOf,
  resetText,
  shownWindows,
  usage,
  useUsage,
  windowName,
} from './usage'

export const name = 'Sidebar meter'

// Each connected Provider with every window it reports. Also the body of variant D's Usage section.
export function UsageList() {
  const s = useUsage()
  const live = PROVIDERS.filter(p => connected(s, p))
  return (
    <>
      {live.map(p => {
        const model = MODELS.find(m => m.provider === p)!.name
        const blocked = blockedFor(s, model)
        const wins = shownWindows(s, p)
        return (
          <div key={p} className="mb-1.5">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-medium text-zinc-700">
                {ICON[p]} {p}{' '}
                <span className="font-normal text-zinc-400">
                  {PLANS[p][s.providers[p].plan]!.label}
                </span>
              </span>
              {blocked ? (
                <span className="text-red-700">
                  Back at {resetText(blocked.until, s.now)}
                </span>
              ) : onCredits(s, model) ? (
                <span className="text-violet-700">On usage credits</span>
              ) : (
                <Freshness p={p} />
              )}
            </div>
            {wins.length ? (
              <div className="mt-0.5 grid grid-cols-[76px_1fr_30px] items-center gap-x-2 gap-y-0.5">
                {wins.map(w => (
                  <div
                    key={w.id}
                    className="contents"
                    title={`Resets ${resetText(w.resetsAt, s.now)}`}
                  >
                    <span className="text-[10px] text-zinc-500">
                      {windowName(w)}
                    </span>
                    <Bar percent={w.percent} className="h-1" />
                    <span
                      className={`text-right text-[10px] tabular-nums ${text(w.percent)}`}
                    >
                      {w.percent >= 100 ? 'full' : `${Math.round(w.percent)}%`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-zinc-400">
                No limits reported
              </div>
            )}
          </div>
        )
      })}
      {!live.length && (
        <div className="text-[11px] text-zinc-400">No Provider connected</div>
      )}
    </>
  )
}

function SidebarFooter() {
  return (
    <div className="border-t border-zinc-200 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        Usage
        <button
          onClick={usage.openSettings}
          className="tracking-normal normal-case hover:text-zinc-900"
        >
          Details
        </button>
      </div>
      <UsageList />
    </div>
  )
}

function Above() {
  const s = useUsage()
  const blocked = blockedFor(s, s.model)
  if (!blocked) return null
  const other = PROVIDERS.find(
    p => p !== providerOf(s.model) && connected(s, p)
  )
  return (
    <div className="mb-1 text-[11px] text-red-700">
      {blocked.provider}'s {blocked.window.toLowerCase()} limit is reached until{' '}
      {resetText(blocked.until, s.now)}.
      {other && ` Pick a ${other} Model to keep going.`}
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
    SidebarFooter,
    openSettings: usage.openSettings,
  }
}
