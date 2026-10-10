// PROTOTYPE variant D: A + B, the user's pick. Usage is a third sidebar section under Files (collapsible and
// resizable like it, VS Code style) with every window each Provider reports, plus B's ring next to the Model pill,
// its limit card in place of the Input, and Retry with the other Provider. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'

import {ICON, Ring} from './common'
import {
  blockedFor,
  connected,
  MODELS,
  PROVIDERS,
  shownWindows,
  usage,
  useUsage,
} from './usage'
import {UsageList} from './VariantA'
import {Above, LimitStatus, Toolbar} from './VariantB'

export const name = 'Sidebar section + Input ring'

// While collapsed: one ring per Provider for its fullest window, red when it's limited.
function Badge() {
  const s = useUsage()
  return (
    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
      {PROVIDERS.filter(p => connected(s, p)).map(p => {
        const wins = shownWindows(s, p).filter(w => !w.model)
        const top = Math.max(0, ...wins.map(w => w.percent))
        const blocked = blockedFor(s, MODELS.find(m => m.provider === p)!.name)
        return (
          <span
            key={p}
            title={`${p}: ${Math.round(top)}%`}
            className={`flex items-center gap-0.5 ${blocked ? 'text-red-700' : ''}`}
          >
            {ICON[p]}
            {wins.length ? <Ring percent={top} size={12} /> : '–'}
          </span>
        )
      })}
    </div>
  )
}

function Actions() {
  return (
    <button
      onClick={usage.openSettings}
      className="text-[10px] text-zinc-400 hover:text-zinc-900"
    >
      Details
    </button>
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
    SidebarSection: {title: 'Usage', Body: UsageList, Badge, Actions},
    openSettings: usage.openSettings,
  }
}
