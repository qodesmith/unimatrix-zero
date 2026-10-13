// PROTOTYPE: pieces shared by the error-state variants (#40): what a cut-off Reply says, the sign-in-again dialog,
// Settings (Connections, Updates & About), the problem toasts, and the debug panel. Throw away.
import {useEffect, useRef, useState} from 'react'

import {useSim} from '../canvas-mode-ux/shared'
import {spreadReplies, type TreeSim, type Turn} from '../canvas-mode-ux/tree'
import {ICON, ModelPill, UsageDetails} from '../usage-display/common'
import {
  connected,
  PLANS,
  providerOf,
  PROVIDERS,
  usage,
  useUsage,
  type Provider,
} from '../usage-display/usage'
import {useToast} from '../workspace-file-tree/common'
import {
  alternativeTo,
  blockerFor,
  health,
  NEXT_VERSION,
  problems,
  RECONNECT_FOR,
  useHealth,
  VERSION,
  type Problem,
} from './health'

const btnRed =
  'nodrag rounded-md bg-red-600 px-2 py-0.5 text-white hover:bg-red-500 disabled:bg-zinc-300'
const btnDark =
  'nodrag rounded-md bg-zinc-900 px-2 py-0.5 text-xs text-white hover:bg-zinc-700 disabled:bg-zinc-300'
const btnGhost =
  'nodrag rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100'

// ---------- a Reply that was cut off or refused ----------

// One line under the Reply: what happened in plain words, and one thing to do about it.
export function IssueStatus({reply, sim}: {reply: Turn; sim: TreeSim}) {
  const h = useHealth()
  const p = providerOf(reply.model)
  if (reply.status === 'streaming' && reply.waiting)
    return (
      <span className="flex flex-wrap items-center gap-2 text-[11px] text-amber-700">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
        Connection lost · reconnecting…
        <button onClick={() => sim.stop(reply.id)} className={btnGhost}>
          ■ Stop
        </button>
      </span>
    )
  const issue = reply.issue!
  const retry = (
    <button onClick={() => sim.retry(reply.id)} className={btnRed}>
      ↻ Retry
    </button>
  )
  const ph = h.providers[p]
  let what: string
  let action = retry
  switch (issue.kind) {
    case 'signin':
    case 'signedOut':
      what =
        issue.kind === 'signin'
          ? `${p} sign-in expired`
          : `Stopped: you signed out of ${p}`
      if (ph.signIn !== 'ok')
        action = (
          <button onClick={() => health.openReconnect(p)} className={btnDark}>
            Sign in again
          </button>
        )
      break
    case 'offline':
      what = h.offline
        ? 'Connection lost · Retry once you’re back online'
        : 'Connection lost'
      action = (
        <button
          disabled={h.offline}
          onClick={() => sim.retry(reply.id)}
          className={btnRed}
        >
          ↻ Retry
        </button>
      )
      break
    case 'crash':
      what = `${p} stopped unexpectedly`
      break
    case 'wontStart':
      what = `${p} couldn't start`
      if (ph.program !== 'ok')
        action =
          ph.program === 'repairing' ? (
            <span className="text-sky-700">
              Repairing… {Math.round(ph.repair)}%
            </span>
          ) : (
            <button onClick={() => health.repair(p)} className={btnDark}>
              Repair {p}
            </button>
          )
      break
    case 'outage':
      what = `${p} is having trouble on its end`
      break
  }
  const alt = alternativeTo(h, reply.model!)
  const offerAlt =
    alt &&
    (issue.kind === 'outage' ||
      ((issue.kind === 'signin' || issue.kind === 'signedOut') &&
        ph.signIn !== 'ok') ||
      (issue.kind === 'wontStart' && ph.program !== 'ok'))
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] text-red-700">
      {what}
      {action}
      {offerAlt && (
        <button
          onClick={() => sim.retry(reply.id, alt)}
          className="nodrag text-zinc-500 underline hover:text-zinc-900"
        >
          or retry with {alt}
        </button>
      )}
    </span>
  )
}

// ---------- the Input when its Provider can't take a Prompt ----------

const CARD_COPY: Record<string, (p: Provider) => string> = {
  offline: () =>
    "You're offline. Your draft is kept; send it when you're back.",
  signin: p => `${p} needs you to sign in again. Your draft is kept.`,
  signedOut: p => `You're signed out of ${p}. Your draft is kept.`,
  wontStart: p => `${p} couldn't start on this computer. Your draft is kept.`,
}

// The card that stands in for the Input (variant B) or the slim note above it (A, C).
export function InputBlock({slim}: {slim?: boolean}) {
  const h = useHealth()
  const u = useUsage()
  const p = providerOf(u.model)
  const b = blockerFor(h, p)
  if (!b) return null
  const ph = h.providers[p]
  const alt = b.kind === 'offline' ? undefined : alternativeTo(h, u.model)
  const action =
    b.kind === 'signin' || b.kind === 'signedOut' ? (
      <button onClick={() => health.openReconnect(p)} className={btnDark}>
        {b.kind === 'signin' ? 'Sign in again' : 'Sign in'}
      </button>
    ) : b.kind === 'wontStart' ? (
      ph.program === 'repairing' ? (
        <span className="text-sky-700">
          Repairing… {Math.round(ph.repair)}%
        </span>
      ) : h.repairFails ? (
        <button
          onClick={() => health.log('Report a problem (bug-reporting ticket)')}
          className={btnDark}
        >
          Report a problem…
        </button>
      ) : (
        <button onClick={() => health.repair(p)} className={btnDark}>
          Repair {p}
        </button>
      )
    ) : null
  if (slim)
    return (
      <div className="mb-1 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
        <span>
          {b.kind === 'offline'
            ? 'Offline · sending waits for the connection'
            : `Can't send to ${p}: ${b.kind === 'wontStart' ? 'it couldn’t start' : 'sign-in needed'}`}
        </span>
        {action}
        {alt && (
          <button
            onClick={() => usage.setModel(alt)}
            className="text-amber-800 underline"
          >
            use {alt}
          </button>
        )}
      </div>
    )
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 shadow-sm">
      <div className="font-medium">
        {b.kind !== 'offline' && `${ICON[p]} `}
        {CARD_COPY[b.kind]!(p)}
      </div>
      {b.kind === 'signin' && (
        <div className="mt-0.5 text-amber-800">
          Sign-ins expire every few weeks. Anything that was cut off picks up
          again afterwards.
        </div>
      )}
      {b.kind === 'offline' && (
        <div className="mt-0.5 text-amber-800">
          Browsing, search, Exports and Archives still work.
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action}
        {alt && (
          <button
            onClick={() => usage.setModel(alt)}
            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 hover:bg-amber-100"
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

// ---------- signing in again ----------

type Step = 'start' | 'browser' | 'paste' | 'checking' | 'done'

// The Connections card's flow from onboarding, in a dialog: vendor page → paste the code (Claude) → check the plan.
export function ReconnectDialog() {
  const h = useHealth()
  const u = useUsage()
  const p = h.reconnect
  const [step, setStep] = useState<Step>('start')
  const [code, setCode] = useState('')
  const [other, setOther] = useState(false)
  useEffect(() => {
    setStep('start')
    setCode('')
  }, [p])
  useEffect(() => {
    if (step !== 'checking') return
    const t = setTimeout(() => setStep('done'), 900)
    return () => clearTimeout(t)
  }, [step])
  if (!p) return null
  const ph = h.providers[p]
  const why =
    ph.signIn === 'signedOut'
      ? `You signed out of ${p}.`
      : `Your ${p} sign-in expired. They last a few weeks.`
  const email = other
    ? p === 'Claude'
      ? 'robin@example.com'
      : 'robin.k@example.com'
    : ph.email
  return (
    <div
      className="fixed inset-0 z-[66] flex items-center justify-center bg-black/30"
      onClick={health.closeReconnect}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-[380px] rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-1 flex items-center gap-2 text-base font-semibold">
          {ICON[p]} Sign in to {p}
        </div>
        {h.offline ? (
          <>
            <p className="text-sm text-zinc-600">
              You're offline. Signing in needs a connection.
            </p>
            <div className="mt-4 flex justify-end">
              <button onClick={health.closeReconnect} className={btnGhost}>
                Close
              </button>
            </div>
          </>
        ) : step === 'start' ? (
          <>
            <p className="text-sm text-zinc-600">
              {why} Nothing in your Trees is lost.
            </p>
            <ol className="mt-3 space-y-1 text-xs text-zinc-500">
              <li>1. Sign in on the {p} page in your browser</li>
              {p === 'Claude' && <li>2. Paste the code it shows you</li>}
              <li>{p === 'Claude' ? 3 : 2}. We check your plan</li>
            </ol>
            <p className="mt-3 text-[11px] text-zinc-400">
              The page may say "{p === 'Claude' ? 'Claude Code' : 'Codex'}".
              That's expected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={health.closeReconnect} className={btnGhost}>
                Not now
              </button>
              <button onClick={() => setStep('browser')} className={btnDark}>
                Open {p} sign-in ↗
              </button>
            </div>
          </>
        ) : step === 'browser' ? (
          <>
            <p className="text-sm text-zinc-600">
              Finish signing in on the page that opened in your browser.
            </p>
            <div className="mt-3 rounded-md border border-dashed border-fuchsia-300 bg-fuchsia-50 p-2 font-mono text-[11px] text-fuchsia-900">
              (prototype) the browser:
              <label className="mt-1 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={other}
                  onChange={e => setOther(e.target.checked)}
                />
                sign in as a different account
              </label>
              <button
                onClick={() => setStep(p === 'Claude' ? 'paste' : 'checking')}
                className="mt-1 rounded border border-fuchsia-400 px-1.5 py-0.5 hover:bg-fuchsia-100"
              >
                Signed in on the page →
              </button>
            </div>
            <div className="mt-4 flex justify-between">
              <button
                onClick={() => setStep('browser')}
                className="text-xs text-zinc-500 underline"
              >
                Open the page again
              </button>
              <button onClick={health.closeReconnect} className={btnGhost}>
                Cancel
              </button>
            </div>
          </>
        ) : step === 'paste' ? (
          <>
            <p className="text-sm text-zinc-600">
              Paste the code the page shows you.
            </p>
            <input
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Paste code"
              className="mt-3 w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm outline-none focus:border-zinc-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={health.closeReconnect} className={btnGhost}>
                Cancel
              </button>
              <button onClick={() => setStep('checking')} className={btnDark}>
                Continue
              </button>
            </div>
          </>
        ) : step === 'checking' ? (
          <p className="py-4 text-sm text-zinc-600">Checking your plan…</p>
        ) : (
          <>
            <p className="text-sm text-zinc-700">
              ✓ Signed in as <b>{email}</b> ·{' '}
              {PLANS[p][u.providers[p].plan]!.label}
            </p>
            {other && (
              <p className="mt-2 rounded-md bg-sky-50 p-2 text-xs text-sky-900">
                That's a different account from before. Your Trees carry on with
                it, and usage now counts against this account.
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  health.set({otherAccount: other})
                  health.signedIn(p)
                  setOther(false)
                }}
                className={btnDark}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Settings ----------

const SECTIONS = [
  'Appearance',
  'Chat',
  'System prompts',
  'Tools',
  'Connections',
  'Storage',
  'Archive & restore',
  'Updates & About',
] as const

// One Provider's sign-in and program status, with the one thing to do about it.
export function ProviderStatus({p, compact}: {p: Provider; compact?: boolean}) {
  const h = useHealth()
  const u = useUsage()
  const ph = h.providers[p]
  const plan = PLANS[p][u.providers[p].plan]!.label
  const line = (tone: string, text: string, action?: React.ReactNode) => (
    <div className={`flex flex-wrap items-center gap-2 text-[11px] ${tone}`}>
      <span>{text}</span>
      {action}
    </div>
  )
  if (ph.program === 'repairing')
    return line('text-sky-700', `Repairing… ${Math.round(ph.repair)}%`)
  if (ph.program === 'wontStart')
    return line(
      'text-red-700',
      h.repairFails ? "Still won't start" : "Couldn't start",
      h.repairFails ? (
        <button
          onClick={() => health.log('Report a problem (bug-reporting ticket)')}
          className={btnDark}
        >
          Report a problem…
        </button>
      ) : (
        <button onClick={() => health.repair(p)} className={btnDark}>
          Repair
        </button>
      )
    )
  if (ph.signIn === 'expired')
    return line(
      'text-amber-700',
      'Sign-in expired',
      <button onClick={() => health.openReconnect(p)} className={btnDark}>
        Sign in again
      </button>
    )
  if (ph.signIn === 'signedOut')
    return line(
      'text-zinc-600',
      'Signed out',
      <button onClick={() => health.openReconnect(p)} className={btnDark}>
        Sign in
      </button>
    )
  if (ph.outage && ph.outageSeen)
    return line(
      'text-amber-700',
      'Having trouble on its end',
      <button
        onClick={() => health.log(`Opened ${p}'s status page`)}
        className="underline"
      >
        Status page ↗
      </button>
    )
  return line(
    'text-zinc-500',
    compact ? (h.offline ? 'Offline' : 'Signed in') : `${ph.email} · ${plan}`
  )
}

function SignOutButton({p}: {p: Provider}) {
  const h = useHealth()
  const [confirm, setConfirm] = useState<number | null>(null)
  if (h.providers[p].signIn === 'signedOut') return null
  if (confirm !== null)
    return (
      <div className="mt-2 rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-700">
        {confirm} {confirm === 1 ? 'Reply is' : 'Replies are'} still running on{' '}
        {p}. Signing out stops {confirm === 1 ? 'it' : 'them'} and keeps what{' '}
        {confirm === 1 ? 'it has' : 'they have'} written.
        <div className="mt-1.5 flex gap-2">
          <button
            onClick={() => {
              health.signOut(p)
              setConfirm(null)
            }}
            className={btnDark}
          >
            Sign out
          </button>
          <button onClick={() => setConfirm(null)} className={btnGhost}>
            Cancel
          </button>
        </div>
      </div>
    )
  return (
    <button
      onClick={() => {
        const n = health.runningOn(p).length
        if (n) setConfirm(n)
        else health.signOut(p)
      }}
      className="text-[11px] text-zinc-500 underline"
    >
      Sign out
    </button>
  )
}

function UpdatesSection() {
  const h = useHealth()
  const u = h.update
  return (
    <div className="space-y-3 text-sm">
      <div>
        Unimatrix Zero <b>{VERSION}</b>
      </div>
      <div className="rounded-xl border border-zinc-200 p-3">
        <UpdateLine />
      </div>
      {u.phase === 'failed' && (
        <p className="text-xs text-zinc-500">
          {u.reason === 'check'
            ? 'Every update is signed; this one didn’t match, so it was thrown away. Trying again downloads it fresh.'
            : 'Trying again picks up a fresh download.'}
        </p>
      )}
    </div>
  )
}

// The update's state in one line with one action; used in Settings and by the variants.
export function UpdateLine({small}: {small?: boolean}) {
  const h = useHealth()
  const u = h.update
  const cls = small ? 'text-[11px]' : 'text-xs'
  const wrap = (text: React.ReactNode, action?: React.ReactNode) => (
    <div className={`flex flex-wrap items-center gap-2 ${cls}`}>
      <span>{text}</span>
      {action}
    </div>
  )
  switch (u.phase) {
    case 'none':
      return wrap(
        h.offline ? (
          <span className="text-zinc-500">
            Can't check for updates while offline
          </span>
        ) : (
          <span className="text-zinc-500">You're up to date</span>
        )
      )
    case 'available':
      return wrap(
        `Update available: ${NEXT_VERSION}`,
        <button
          disabled={h.offline}
          onClick={health.downloadUpdate}
          className={btnDark}
        >
          Download
        </button>
      )
    case 'downloading':
      return wrap(
        <span className="flex items-center gap-2">
          Downloading {NEXT_VERSION}…
          <span className="inline-block h-1 w-20 overflow-hidden rounded bg-zinc-200">
            <span
              className="block h-full bg-sky-500"
              style={{width: `${u.progress}%`}}
            />
          </span>
        </span>
      )
    case 'failed':
      return wrap(
        <span className="text-red-700">
          {u.reason === 'network'
            ? "The update didn't finish downloading"
            : "The update didn't pass its safety check"}
        </span>,
        <button
          disabled={h.offline}
          onClick={health.downloadUpdate}
          className={btnDark}
        >
          Try again
        </button>
      )
    case 'ready':
      return wrap(
        `${NEXT_VERSION} is ready`,
        <button onClick={health.restartToUpdate} className={btnDark}>
          Restart to update
        </button>
      )
  }
}

export function SettingsModal() {
  const h = useHealth()
  const u = useUsage()
  const section = h.settings ?? (u.settingsOpen ? 'Connections' : null)
  if (!section) return null
  const close = () => {
    health.closeSettings()
    usage.closeSettings()
  }
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/30"
      onClick={close}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex h-[560px] w-[760px] overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 text-sm">
          <div className="mb-2 px-2 font-semibold">Settings</div>
          {SECTIONS.map(x => {
            const live = x === 'Connections' || x === 'Updates & About'
            return (
              <button
                key={x}
                disabled={!live}
                onClick={() => health.openSettings(x as typeof section)}
                className={`block w-full rounded-md px-2 py-1 text-left ${x === section ? 'bg-zinc-200 font-medium' : live ? 'hover:bg-zinc-100' : 'text-zinc-400'}`}
              >
                {x}
              </button>
            )
          })}
        </nav>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{section}</h2>
            <button
              onClick={close}
              className="text-zinc-400 hover:text-zinc-900"
            >
              ✕
            </button>
          </div>
          {section === 'Updates & About' ? (
            <UpdatesSection />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.map(p => (
                <div key={p} className="rounded-xl border border-zinc-200 p-3">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {ICON[p]} {p}
                  </div>
                  {connected(u, p) ? (
                    <>
                      <div className="mb-2">
                        <ProviderStatus p={p} />
                      </div>
                      <UsageDetails p={p} />
                      <div className="mt-3 flex items-center gap-3">
                        <SignOutButton p={p} />
                        <button
                          onClick={() => usage.setPlan(p, 'none')}
                          className="text-[11px] text-zinc-500 underline"
                        >
                          Disconnect…
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() =>
                        usage.setPlan(p, p === 'Claude' ? 'max' : 'plus')
                      }
                      className="mt-2 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white"
                    >
                      Connect
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- problem surfaces ----------

const TONE: Record<Problem['tone'], string> = {
  red: 'border-red-200 bg-red-50 text-red-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  zinc: 'border-zinc-200 bg-zinc-100 text-zinc-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-900',
}
export const toneClass = (t: Problem['tone']) => TONE[t]

export function ProblemAction({p}: {p: Problem}) {
  return (
    <>
      {p.action && (
        <button
          onClick={p.action.run}
          className="shrink-0 rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] text-white hover:bg-zinc-700"
        >
          {p.action.label}
        </button>
      )}
      {p.dismiss && (
        <button
          onClick={p.dismiss}
          title="Dismiss"
          className="shrink-0 text-xs opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </>
  )
}

// Toasts once when a problem first appears; `say` words it for the variant.
export function useProblemToasts(say: (p: Problem) => string | null) {
  const h = useHealth()
  const toast = useToast()
  const seen = useRef<Set<string>>(new Set())
  const list = problems(h)
  useEffect(() => {
    const ids = new Set(list.map(p => p.id))
    for (const p of list)
      if (!seen.current.has(p.id)) {
        const msg = say(p)
        if (msg) toast(msg)
      }
    seen.current = ids
  })
}

// ---------- prototype chrome ----------

export function HealthDebug({question}: {question: string}) {
  const h = useHealth()
  const u = useUsage()
  const sim = useSim()
  const [open, setOpen] = useState(true)
  const streaming = Object.values(sim.tree).filter(
    t => t.status === 'streaming'
  )
  const spread = spreadReplies(sim.tree, 3)
  const btn =
    'rounded border border-fuchsia-400 px-1.5 py-0.5 hover:bg-fuchsia-100 disabled:opacity-40'
  const toggle = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void
  ) => (
    <label className="flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
  return (
    <div className="fixed top-24 right-3 z-[60] w-72 rounded-lg border border-fuchsia-300 bg-fuchsia-50/95 p-2.5 font-mono text-[11px] text-fuchsia-950 shadow">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full justify-between font-bold"
      >
        PROTOTYPE · Error states <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-[80vh] space-y-2 overflow-y-auto">
          <div className="text-fuchsia-700">{question}</div>
          <div className="border-t border-fuchsia-200 pt-1.5">
            <b>Network</b> {h.offline ? '(offline)' : '(online)'}
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                className={btn}
                onClick={h.offline ? health.goOnline : health.goOffline}
              >
                {h.offline ? 'Back online' : 'Go offline'}
              </button>
            </div>
            <div className="text-fuchsia-700">
              Running Replies reconnect for {RECONNECT_FOR / 1000}s, then fail.
            </div>
          </div>
          {PROVIDERS.filter(p => connected(u, p)).map(p => {
            const ph = h.providers[p]
            return (
              <div key={p} className="border-t border-fuchsia-200 pt-1.5">
                <b>{p}</b> sign-in: {ph.signIn} · program: {ph.program}
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    className={btn}
                    disabled={ph.signIn !== 'ok'}
                    onClick={() => health.lapse(p)}
                  >
                    Sign-in expires
                  </button>
                  <button className={btn} onClick={() => health.crash(p)}>
                    Crashes now
                  </button>
                  <button
                    className={btn}
                    disabled={ph.crashNext}
                    onClick={() => health.crashOnSend(p)}
                  >
                    Crashes on next send
                  </button>
                  <button
                    className={btn}
                    disabled={ph.program !== 'ok'}
                    onClick={() => health.breakProgram(p)}
                  >
                    Program won't start
                  </button>
                </div>
                {toggle(`${p} outage (5xx / overloaded)`, ph.outage, v =>
                  health.setOutage(p, v)
                )}
              </div>
            )
          })}
          <div className="space-y-1 border-t border-fuchsia-200 pt-1.5">
            <b>Update</b>
            <div className="flex flex-wrap gap-1">
              <button
                className={btn}
                disabled={h.update.phase !== 'none'}
                onClick={health.offerUpdate}
              >
                Offer an update
              </button>
            </div>
            {toggle(
              'Next download fails its signature check',
              h.updateFailsCheck,
              v => health.set({updateFailsCheck: v})
            )}
            <div className="text-fuchsia-700">
              Go offline mid-download for the network failure.
            </div>
          </div>
          <div className="space-y-1 border-t border-fuchsia-200 pt-1.5">
            {toggle(
              'Cut-off Replies retry by themselves after signing in',
              h.autoRetry,
              v => health.set({autoRetry: v})
            )}
            {toggle('Repair fails too', h.repairFails, v =>
              health.set({repairFails: v})
            )}
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
              Start 3 Replies at once ({u.model})
            </button>
          </div>
          <div className="border-t border-fuchsia-200 pt-1.5 text-fuchsia-700">
            {h.events.map(e => (
              <div key={e.id}>
                {new Date(e.at).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })}{' '}
                {e.text}
              </div>
            ))}
            {!h.events.length && 'Nothing has happened yet'}
          </div>
        </div>
      )}
    </div>
  )
}
