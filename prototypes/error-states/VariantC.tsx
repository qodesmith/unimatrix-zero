// PROTOTYPE variant C: one place to look. The sidebar's Usage section becomes Connections: the app's own status
// (offline, update), then each Provider's sign-in and program state with its action, then usage. A problem toasts
// once and points there; the Input only gets a chip by the Model pill. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'

import {ICON} from '../usage-display/common'
import {
  connected,
  providerOf,
  PROVIDERS,
  useUsage,
} from '../usage-display/usage'
import {UsageList} from '../usage-display/VariantA'
import {
  Above as LimitCard,
  Toolbar as UsageToolbar,
} from '../usage-display/VariantB'
import * as D from '../usage-display/VariantD'
import {
  IssueStatus,
  ProviderStatus,
  UpdateLine,
  useProblemToasts,
} from './common'
import {blockerFor, health, problems, useHealth} from './health'

export const name = 'Connections section + toasts'

function Body() {
  const h = useHealth()
  const u = useUsage()
  useProblemToasts(p =>
    p.id === 'offline'
      ? "You're offline · see Connections in the sidebar"
      : p.id.endsWith('-program') && p.tone === 'sky'
        ? null
        : `${p.text} See Connections in the sidebar.`
  )
  return (
    <div className="space-y-2">
      {(h.offline || h.update.phase !== 'none') && (
        <div className="space-y-1 rounded-md bg-zinc-50 px-2 py-1.5">
          {h.offline && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-700">
              <span className="size-1.5 rounded-full bg-zinc-400" />
              Offline · browsing works, sending waits
            </div>
          )}
          {h.update.phase !== 'none' && <UpdateLine small />}
        </div>
      )}
      {PROVIDERS.filter(p => connected(u, p)).map(p => (
        <div key={p} className="flex items-center gap-1.5 text-[11px]">
          <span className="w-16 shrink-0 font-medium text-zinc-700">
            {ICON[p]} {p}
          </span>
          <ProviderStatus p={p} compact />
        </div>
      ))}
      <div className="border-t border-zinc-100 pt-1.5">
        <UsageList />
      </div>
    </div>
  )
}

const DOT = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  zinc: 'bg-zinc-400',
  sky: 'bg-sky-500',
}

// While collapsed: a dot per problem, coloured by how bad it is.
function Badge() {
  const h = useHealth()
  const list = problems(h)
  return (
    <div className="flex items-center gap-1">
      {list.length ? (
        list.map(p => (
          <span
            key={p.id}
            title={p.text}
            className={`size-2 rounded-full ${DOT[p.tone]}`}
          />
        ))
      ) : (
        <D.Badge />
      )}
    </div>
  )
}

function Actions() {
  return (
    <button
      onClick={() => health.openSettings()}
      className="text-[10px] text-zinc-400 hover:text-zinc-900"
    >
      Details
    </button>
  )
}

// A chip by the Model pill when the picked Model's Provider can't take a Prompt.
function Toolbar() {
  const h = useHealth()
  const u = useUsage()
  const p = providerOf(u.model)
  const b = blockerFor(h, p)
  return (
    <>
      <UsageToolbar />
      {b?.kind === 'offline' && (
        <span className="ml-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
          Offline · sending waits
        </span>
      )}
      {b && b.kind !== 'offline' && (
        <button
          onClick={() =>
            b.kind === 'signin' || b.kind === 'signedOut'
              ? health.openReconnect(p)
              : health.repair(p)
          }
          className="ml-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 hover:bg-amber-200"
        >
          {b.kind === 'wontStart'
            ? `${p} couldn't start · Repair`
            : `Sign in to ${p}`}
        </button>
      )}
    </>
  )
}

export function useUi(): UsageUi {
  const base = D.useUi()
  const h = useHealth()
  const u = useUsage()
  const blocker = !!blockerFor(h, providerOf(u.model))
  return {
    ...base,
    Toolbar,
    Above: LimitCard,
    blocked: base.blocked || blocker,
    IssueStatus,
    SidebarSection: {title: 'Connections', Body, Badge, Actions},
    openSettings: () => health.openSettings(),
  }
}
