// PROTOTYPE variant D: onboarding as a scripted chat with tap-to-answer chips, which turns into the first Tree. Throw away.
import {useEffect, useRef, useState, type ReactNode} from 'react'

import {CodeEntry, Progress, ReopenLink, SettingsSheet} from './harness'
import {INFO, Logo, PROVIDERS, errorAction, useSim, type ProviderId} from './sim'

export const name = 'Guided chat'

type Line = {who: 'app' | 'me'; body: ReactNode; key: string}

export function VariantD() {
  const {state, dispatch} = useSim()
  const [lines, setLines] = useState<Line[]>([
    {who: 'app', key: 'hi', body: "Hi! 👋 I'll help you start talking with Claude or ChatGPT. It takes about two minutes."},
    {who: 'app', key: 'ask', body: 'Which one do you have a paid plan for?'},
  ])
  const [queue, setQueue] = useState<ProviderId[]>([])
  const [current, setCurrent] = useState<ProviderId | null>(null)
  const [phase, setPhase] = useState<'ask' | 'connecting' | 'more' | 'ready'>('ask')
  const [settings, setSettings] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const say = (who: Line['who'], body: ReactNode) => setLines(l => [...l, {who, body, key: `${l.length}`}])

  useEffect(() => {
    end.current?.scrollIntoView({behavior: 'smooth'})
  }, [lines, phase, current && state.status[current].kind])

  const start = (ps: ProviderId[]) => {
    setQueue(ps.slice(1))
    setCurrent(ps[0]!)
    setPhase('connecting')
    dispatch({type: 'connect', p: ps[0]!})
  }

  const st = current ? state.status[current] : null
  useEffect(() => {
    if (!current || st?.kind !== 'connected') return
    say('app', `You're connected to ${INFO[current].name} as ${st.email} (${st.plan}). 🎉`)
    const [next, ...rest] = queue
    if (next) {
      say('app', `Now ${INFO[next].name}.`)
      setQueue(rest)
      setCurrent(next)
      dispatch({type: 'connect', p: next})
    } else {
      setCurrent(null)
      const other = PROVIDERS.find(p => state.status[p].kind !== 'connected')
      setPhase(other ? 'more' : 'ready')
      if (other) say('app', `Want to connect ${INFO[other].name} too? You can always do it later in Settings.`)
      else say('app', "You're ready. Type your first message below.")
    }
  }, [st?.kind])

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center border-b px-4 py-2">
        <span className="font-semibold">Unimatrix Zero</span>
        <span className="ml-2 text-sm text-slate-400">· {phase === 'ready' ? 'New Tree' : 'Getting started'}</span>
        <div className="flex-1" />
        <button onClick={() => setSettings(true)} className="rounded-lg border px-2 py-1 text-sm">
          ⚙ Settings
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
          {lines.map(l => (
            <Bubble key={l.key} who={l.who}>
              {l.body}
            </Bubble>
          ))}
          {phase === 'ask' && (
            <Chips>
              <Chip onClick={() => (say('me', 'Claude'), start(['claude']))}>
                <Logo p="claude" size={16} /> Claude
              </Chip>
              <Chip onClick={() => (say('me', 'ChatGPT'), start(['chatgpt']))}>
                <Logo p="chatgpt" size={16} /> ChatGPT
              </Chip>
              <Chip onClick={() => (say('me', 'Both'), start(['claude', 'chatgpt']))}>Both</Chip>
              <Chip
                onClick={() => {
                  say('me', "I'm not sure")
                  say('app', "If you pay for Claude Pro or Max, or ChatGPT Plus or Pro, you have one. Free accounts won't work. Ask whoever pays for it, or sign up on claude.ai or chatgpt.com and come back. Which one do you have?")
                }}
              >
                I'm not sure
              </Chip>
            </Chips>
          )}
          {phase === 'connecting' && current && <Live p={current} />}
          {phase === 'more' && (
            <Chips>
              {PROVIDERS.filter(p => state.status[p].kind !== 'connected').map(p => (
                <Chip key={p} onClick={() => (say('me', `Yes, connect ${INFO[p].name}`), start([p]))}>
                  Yes, connect {INFO[p].name}
                </Chip>
              ))}
              <Chip onClick={() => (say('me', 'Not now'), say('app', "You're ready. Type your first message below."), setPhase('ready'))}>Not now</Chip>
            </Chips>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className={`border-t p-4 transition-opacity ${phase === 'ready' ? '' : 'pointer-events-none opacity-30'}`}>
        <div className="mx-auto flex max-w-xl gap-2 rounded-2xl border p-2">
          <input className="flex-1 px-2 outline-none" placeholder={phase === 'ready' ? 'Ask anything… (this becomes the root Prompt of your first Tree)' : 'Connect an AI first'} />
          <button className="rounded-lg bg-slate-900 px-3 py-1 text-sm text-white">Send</button>
        </div>
      </div>
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  )
}

// The live bubble for the Provider being connected: it changes in place instead of adding a line per state.
function Live({p}: {p: ProviderId}) {
  const {state, dispatch} = useSim()
  const st = state.status[p]
  const n = INFO[p].name
  let body: ReactNode = null
  if (st.kind === 'downloading')
    body = (
      <div className="flex flex-col gap-2">
        <span>
          Getting {n} ready on this computer… ({Math.round((st.pct / 100) * INFO[p].sizeMb)} of {INFO[p].sizeMb} MB)
        </span>
        <Progress pct={st.pct} color={INFO[p].color} />
      </div>
    )
  else if (st.kind === 'opening') body = `Opening ${n}'s page in your web browser…`
  else if (st.kind === 'waiting')
    body = (
      <div className="flex flex-col gap-1">
        <span>
          I opened {n}'s page in your browser. Sign in there and click <b>{p === 'claude' ? 'Authorize' : 'Continue'}</b>. (It may say “{p === 'claude' ? 'Claude Code' : 'Codex'}”. That's normal.)
        </span>
        <ReopenLink p={p} />
      </div>
    )
  else if (st.kind === 'needs-code')
    body = (
      <div className="flex flex-col gap-2">
        <span>Almost done! {n}'s page is showing a code. Copy it and paste it here:</span>
        <CodeEntry p={p} big />
      </div>
    )
  else if (st.kind === 'checking') body = 'Checking your plan…'
  else if (st.kind === 'error')
    body = (
      <div className="flex flex-col items-start gap-2">
        <span>
          Hmm. {st.reason === 'download' ? `I couldn't get ${n} ready. Is the internet working?` : st.reason === 'offline' ? "It looks like you're offline." : st.reason === 'cancelled' ? `It looks like sign-in was cancelled on ${n}'s page.` : st.reason === 'timeout' ? `I didn't hear back from ${n}'s page.` : `That ${n} account is on the free plan. You need ${n} ${INFO[p].plans}.`}
        </span>
        <Chip onClick={() => dispatch({type: 'connect', p})}>{errorAction(st.reason)}</Chip>
      </div>
    )
  if (!body) return null
  return <Bubble who="app">{body}</Bubble>
}

function Bubble({who, children}: {who: 'app' | 'me'; children: ReactNode}) {
  return (
    <div className={`flex ${who === 'me' ? 'justify-end' : 'gap-2'}`}>
      {who === 'app' && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">UZ</div>}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${who === 'me' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{children}</div>
    </div>
  )
}
const Chips = ({children}: {children: ReactNode}) => <div className="flex flex-wrap justify-end gap-2">{children}</div>
const Chip = ({onClick, children}: {onClick: () => void; children: ReactNode}) => (
  <button onClick={onClick} className="flex items-center gap-1.5 rounded-full border-2 border-indigo-200 bg-white px-4 py-1.5 font-medium text-indigo-700 hover:bg-indigo-50">
    {children}
  </button>
)
