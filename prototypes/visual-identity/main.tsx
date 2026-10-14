// PROTOTYPE: Visual identity (#42). The same screen (Tree sidebar, canvas, chat-mode slideout) in four directions,
// switchable via ?variant=A|B|C|D, light and dark via ?mode=system|light|dark (system by default). Hosted on the
// Reconnect, offline and error states prototype's app (its variant A, the winner). Each direction is a Theme in the
// ADR 0009 shape; bridge.ts maps it onto the earlier prototypes' Tailwind classes. Throw away.
import {ReactFlowProvider} from '@xyflow/react'
import {useEffect, useLayoutEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'

import {
  HighlightProvider,
  PrototypeSwitcher,
  SimContext,
  UsageUiContext,
} from '../canvas-mode-ux/shared'
import {useTreeSim, type SimState} from '../canvas-mode-ux/tree'
import {ReconnectDialog, SettingsModal} from '../error-states/common'
import * as Host from '../error-states/VariantA'
import {useLibrary, type Lib} from '../tree-sidebar/common'
import {VariantB as Sidebar} from '../tree-sidebar/VariantB'
import {ToastProvider} from '../workspace-file-tree/common'
import {planFiles} from '../workspace-file-tree/workspace'
import {applyTheme} from './bridge'
import {AppIcon} from './icons'
import {DIRECTIONS, type Direction} from './themes'

type Mode = 'system' | 'light' | 'dark'

// Size watchers run on the next frame, so a callback that changes layout can't re-trigger itself in the same frame.
const NativeResizeObserver = window.ResizeObserver
window.ResizeObserver = class extends NativeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super((entries, observer) =>
      requestAnimationFrame(() => callback(entries, observer))
    )
  }
}
window.addEventListener(
  'error',
  e => {
    if (e.message?.includes('ResizeObserver')) e.stopImmediatePropagation()
  },
  {capture: true}
)

const param = (k: string) => new URLSearchParams(location.search).get(k)
const setParam = (k: string, v: string) => {
  const url = new URL(location.href)
  url.searchParams.set(k, v)
  history.replaceState(null, '', url)
}

function useSystemDark() {
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(mq.matches)
  useEffect(() => {
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

function App() {
  const [variant, setVariant] = useState(() => param('variant') ?? 'A')
  const [mode, setMode] = useState<Mode>(
    () => (param('mode') as Mode | null) ?? 'system'
  )
  const [panel, setPanel] = useState(() => param('panel') !== '0')
  const systemDark = useSystemDark()
  const lib = useLibrary()
  const d = DIRECTIONS.find(x => x.key === variant) ?? DIRECTIONS[0]!
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  const set = d.theme[resolved] ?? d.theme.light ?? d.theme.dark!

  useLayoutEffect(() => {
    applyTheme(set, d.feel)
    document.documentElement.dataset.direction = d.key
  }, [set, d])

  const change = (key: string) => {
    setParam('variant', key)
    setVariant(key)
  }
  const pickMode = (m: Mode) => {
    setParam('mode', m)
    setMode(m)
  }
  const entry = lib.entries.find(e => e.key === lib.current)!
  return (
    <ToastProvider>
      <UsageUiContext.Provider value={Host.useUi()}>
        <TreeView
          key={entry.key}
          entryKey={entry.key}
          init={entry.init}
          lib={lib}
        />
      </UsageUiContext.Provider>
      <SettingsModal />
      <ReconnectDialog />
      {process.env.NODE_ENV !== 'production' && (
        <>
          <PrototypeSwitcher
            variants={DIRECTIONS}
            current={d.key}
            onChange={change}
          />
          <IdentityPanel
            d={d}
            mode={mode}
            resolved={resolved}
            onMode={pickMode}
            open={panel}
            onToggle={() => {
              setParam('panel', panel ? '0' : '1')
              setPanel(!panel)
            }}
            onPick={change}
          />
        </>
      )}
    </ToastProvider>
  )
}

function TreeView({
  entryKey,
  init,
  lib,
}: {
  entryKey: string
  init: () => SimState
  lib: Lib
}) {
  const sim = useTreeSim({key: entryKey, init, planFiles})
  return (
    <SimContext.Provider value={sim}>
      <HighlightProvider>
        <ReactFlowProvider>
          <Sidebar lib={lib} />
        </ReactFlowProvider>
      </HighlightProvider>
    </SimContext.Provider>
  )
}

// Prototype chrome, fixed fuchsia so it reads the same in every Theme.
function IdentityPanel({
  d,
  mode,
  resolved,
  onMode,
  open,
  onToggle,
  onPick,
}: {
  d: Direction
  mode: Mode
  resolved: 'light' | 'dark'
  onMode: (m: Mode) => void
  open: boolean
  onToggle: () => void
  onPick: (k: string) => void
}) {
  const [json, setJson] = useState(false)
  const set = d.theme[resolved]!
  return (
    <div className="uz-chrome text-[11px] text-[#4a044e]">
      {open && (
        <div
          className="fixed top-3 left-[calc(var(--uz-sidebar,290px)+12px)] z-50 w-[380px] rounded-[10px] border border-[#f0abfc] bg-[#fdf4ff]/95 p-3 shadow-lg"
          style={{fontSize: 11, lineHeight: 1.4}}
        >
          <div className="flex items-start gap-3">
            <AppIcon k={d.key} size={56} />
            <div className="min-w-0 flex-1">
              <div style={{fontSize: 13, fontWeight: 700}}>
                {d.key} · {d.name}{' '}
                <span style={{fontWeight: 400}}>(Theme “{d.theme.name}”)</span>
              </div>
              <div className="mt-0.5">{d.pitch}</div>
              <div className="mt-1 opacity-80">
                font {d.feel.fonts} · radius {set.radius} · density{' '}
                {d.feel.density} (not a Theme token) · code {set.shiki}
              </div>
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            {(['#f2f2f2', '#1e1e1e'] as const).map(bg => (
              <div
                key={bg}
                className="flex flex-1 items-end justify-center gap-2.5 rounded-[8px] p-2"
                style={{background: bg}}
              >
                {[56, 32, 16].map(s => (
                  <AppIcon key={s} k={d.key} size={s} />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span>All icons:</span>
            {DIRECTIONS.map(x => (
              <button
                key={x.key}
                onClick={() => onPick(x.key)}
                title={x.name}
                className="rounded-[8px] p-0.5"
                style={{
                  outline:
                    x.key === d.key
                      ? '2px solid #c026d3'
                      : '1px solid transparent',
                }}
              >
                <AppIcon k={x.key} size={32} />
              </button>
            ))}
            <button
              onClick={() => setJson(!json)}
              className="ml-auto rounded-[6px] border border-[#e879f9] px-2 py-0.5 hover:bg-[#fae8ff]"
            >
              {json ? 'Hide' : 'Show'} Theme JSON
            </button>
          </div>
          {json && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-[6px] bg-white p-2 text-[10px] text-[#3b0764]">
              {JSON.stringify(d.theme, null, 2)}
            </pre>
          )}
        </div>
      )}
      <div className="fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#a21caf] px-2 py-1 text-white shadow-lg">
        {(['system', 'light', 'dark'] as const).map(m => (
          <button
            key={m}
            onClick={() => onMode(m)}
            className="rounded-full px-2 py-0.5"
            style={{
              background: m === mode ? '#f5d0fe' : 'transparent',
              color: m === mode ? '#4a044e' : 'white',
            }}
          >
            {m === 'system'
              ? `System (${resolved})`
              : m === 'light'
                ? 'Light'
                : 'Dark'}
          </button>
        ))}
        <span className="mx-1 opacity-50">|</span>
        <button
          onClick={onToggle}
          className="rounded-full px-2 py-0.5 hover:bg-[#c026d3]"
        >
          {open ? 'Hide' : 'Show'} icon & tokens
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
