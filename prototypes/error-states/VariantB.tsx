// PROTOTYPE variant B: problems show where they bite. The Input turns into a card with one action (the same shape as
// the usage-limit card from #36), cut-off Replies say what happened, and the only app-wide sign is a slim sidebar
// footer for offline and the update. A crash is a one-off toast. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'

import {providerOf, useUsage} from '../usage-display/usage'
import {Above as LimitCard} from '../usage-display/VariantB'
import * as D from '../usage-display/VariantD'
import {InputBlock, IssueStatus, UpdateLine, useProblemToasts} from './common'
import {blockerFor, health, useHealth} from './health'

export const name = 'Where it bites (Input card)'

function Above() {
  const h = useHealth()
  const u = useUsage()
  useProblemToasts(p => (p.id.endsWith('-crash') ? p.text : null))
  return blockerFor(h, providerOf(u.model)) ? <InputBlock /> : <LimitCard />
}

function SidebarFooter() {
  const h = useHealth()
  const showUpdate = h.update.phase !== 'none'
  if (!h.offline && !showUpdate) return null
  return (
    <div className="space-y-1 border-t border-zinc-200 px-3 py-2">
      {h.offline && (
        <div
          title="Browsing, search, Exports and Archives still work. Sending waits for the connection."
          className="flex items-center gap-1.5 text-[11px] text-zinc-600"
        >
          <span className="size-1.5 rounded-full bg-zinc-400" />
          Offline
        </div>
      )}
      {showUpdate && <UpdateLine small />}
    </div>
  )
}

export function useUi(): UsageUi {
  const base = D.useUi()
  const h = useHealth()
  const u = useUsage()
  const blocker = blockerFor(h, providerOf(u.model))
  return {
    ...base,
    Above,
    blocked: base.blocked || !!blocker,
    // Offline still lets you write a draft; the card sits above the Input instead of replacing it.
    replaced: base.replaced || (!!blocker && blocker.kind !== 'offline'),
    IssueStatus,
    SidebarFooter,
    openSettings: () => health.openSettings(),
  }
}
