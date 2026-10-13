// PROTOTYPE variant A: app-wide problems are bands across the top of the canvas, like the low-disk band (#29), worst
// first, each with one action. The Input stays put with a slim note and Send disabled. Throw away.
import type {UsageUi} from '../canvas-mode-ux/shared'

import {providerOf, useUsage} from '../usage-display/usage'
import {Above as LimitCard} from '../usage-display/VariantB'
import * as D from '../usage-display/VariantD'
import {
  InputBlock,
  IssueStatus,
  ProblemAction,
  toneClass,
  UpdateLine,
} from './common'
import {blockerFor, health, problems, useHealth} from './health'

export const name = 'Bands across the top'

function Banner() {
  const h = useHealth()
  const list = problems(h)
  const u = h.update
  const showUpdate = u.phase !== 'none' && u.phase !== 'failed'
  if (!list.length && !showUpdate) return null
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex flex-col shadow-sm">
      {list.map(p => (
        <div
          key={p.id}
          className={`flex items-center gap-3 border-b px-4 py-1.5 text-xs ${toneClass(p.tone)}`}
        >
          <span className="min-w-0 flex-1">
            <b className="font-medium">{p.text}</b>
            {p.detail && <span className="opacity-75"> {p.detail}</span>}
          </span>
          <ProblemAction p={p} />
        </div>
      ))}
      {showUpdate && (
        <div className="flex items-center gap-3 border-b border-sky-200 bg-sky-50 px-4 py-1.5 text-sky-900">
          <div className="flex-1">
            <UpdateLine small />
          </div>
          {u.phase === 'available' && (
            <button
              onClick={() => health.set({update: {phase: 'none'}})}
              className="text-[11px] opacity-60 hover:opacity-100"
            >
              Later
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Above() {
  return (
    <>
      <InputBlock slim />
      <LimitCard />
    </>
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
    IssueStatus,
    Banner,
    openSettings: () => health.openSettings(),
  }
}
