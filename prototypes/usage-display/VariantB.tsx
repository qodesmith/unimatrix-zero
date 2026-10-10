// PROTOTYPE variant B: usage lives at the Input, next to the Model pill, and only for the windows that limit that
// Model. Nothing elsewhere. At the limit the Input turns into a card that offers the other Provider. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'
import type {TreeSim, Turn} from '../canvas-mode-ux/tree'

import {Freshness, ModelPill, Ring, usePopover, WindowRow, ICON} from './common'
import {
  blockedFor,
  connected,
  level,
  MODELS,
  onCredits,
  providerOf,
  resetText,
  shownWindows,
  tightest,
  until,
  usage,
  useUsage,
  windowName,
  windowsFor,
  type UsageState,
} from './usage'

export const name = 'At the Input'

// The first Model on another connected Provider that isn't limited.
const alternative = (s: UsageState, model: string) =>
  MODELS.find(
    m =>
      m.provider !== providerOf(model) &&
      connected(s, m.provider) &&
      !blockedFor(s, m.name)
  )?.name

function UsageChip() {
  const s = useUsage()
  const pop = usePopover()
  const p = providerOf(s.model)
  const t = tightest(s, s.model)
  const credits = onCredits(s, s.model)
  if (!t && !credits) return null
  const lv = t ? level(t.percent) : 'ok'
  return (
    <div ref={pop.ref} className="relative ml-auto">
      <button
        onClick={() => pop.setOpen(o => !o)}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] hover:bg-zinc-100 ${credits ? 'text-violet-700' : lv === 'warn' ? 'text-amber-700' : 'text-zinc-500'}`}
      >
        {t && <Ring percent={t.percent} />}
        {credits
          ? 'On usage credits'
          : lv === 'warn'
            ? `${Math.round(t!.percent)}% of ${windowName(t!).toLowerCase()} · resets ${resetText(t!.resetsAt, s.now)}`
            : `${Math.round(t!.percent)}%`}
      </button>
      {pop.open && (
        <div className="absolute right-0 bottom-full z-50 mb-1 w-64 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-lg">
          <div className="mb-1 text-xs font-medium">
            {ICON[p]} {p} usage for {s.model}
          </div>
          {windowsFor(shownWindows(s, p), s.model).map(w => (
            <WindowRow key={w.id} w={w} now={s.now} />
          ))}
          <div className="mt-1 flex items-center justify-between">
            <Freshness p={p} />
            <button
              onClick={() => {
                pop.setOpen(false)
                usage.openSettings()
              }}
              className="text-[10px] text-zinc-500 underline"
            >
              All usage
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Toolbar() {
  return (
    <>
      <ModelPill />
      <UsageChip />
    </>
  )
}

// Stands in for the Input while its Model is limited; the draft is kept underneath.
function Above() {
  const s = useUsage()
  const blocked = blockedFor(s, s.model)
  if (!blocked) return null
  const alt = alternative(s, s.model)
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 shadow-sm">
      <div className="font-medium">
        {ICON[blocked.provider as 'Claude']} {blocked.provider}'s{' '}
        {blocked.window.toLowerCase()} limit is reached
      </div>
      <div className="mt-0.5 text-red-800">
        It resets at {resetText(blocked.until, s.now)} (in{' '}
        {until(blocked.until, s.now)}). Your draft is kept.
      </div>
      <div className="mt-2 flex items-center gap-2">
        {alt && (
          <button
            onClick={() => usage.setModel(alt)}
            className="rounded-md bg-zinc-900 px-2 py-1 text-white hover:bg-zinc-700"
          >
            Continue with {alt}
          </button>
        )}
        <div className="rounded-md bg-white">
          <ModelPill />
        </div>
      </div>
    </div>
  )
}

function LimitStatus({reply, sim}: {reply: Turn; sim: TreeSim}) {
  const s = useUsage()
  const still = blockedFor(s, reply.model!)
  const alt = alternative(s, reply.model!)
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] text-red-700">
      {still
        ? `Limit reached · back at ${resetText(still.until, s.now)}`
        : 'Limit reached'}
      {!still && (
        <button
          onClick={() => sim.retry(reply.id)}
          className="nodrag rounded-md bg-red-600 px-2 py-0.5 text-white hover:bg-red-500"
        >
          ↻ Retry
        </button>
      )}
      {still && alt && (
        <button
          onClick={() => sim.retry(reply.id, alt)}
          className="nodrag rounded-md border border-zinc-300 px-2 py-0.5 text-zinc-700 hover:bg-zinc-100"
        >
          ↻ Retry with {alt}
        </button>
      )}
    </span>
  )
}

export function useUi(): UsageUi {
  const s = useUsage()
  const blocked = !!blockedFor(s, s.model)
  return {
    Toolbar,
    Above,
    blocked,
    replaced: blocked,
    LimitStatus,
    openSettings: usage.openSettings,
  }
}
