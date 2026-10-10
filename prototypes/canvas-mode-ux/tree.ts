// PROTOTYPE: fake Tree + timer-faked streaming for the Canvas mode UX ticket. Throw away.
import {useCallback, useEffect, useRef, useState} from 'react'

export type Status = 'streaming' | 'done' | 'stopped' | 'failed'

export type Attachment = {name: string; type: string; size: number; url: string}

export type FileOp = 'added' | 'modified' | 'deleted'
// One file the AI (on a Reply) or the user (on a Prompt, between Turns) touched. Content is the file after the change.
export type FileChange = {
  path: string
  op: FileOp
  content?: string
  // Bytes. Defaults to the content's length; set for binaries whose content is a URL or isn't kept.
  size?: number
  // Character offset into the Reply text where the change happened, for interleaved rendering.
  at?: number
  // Still being written while the Reply streams.
  writing?: boolean
}

export type Workspace =
  | {kind: 'app'}
  // `base`: what was already in the folder when it was linked, path → content.
  | {kind: 'linked'; path: string; base?: Record<string, string>}

export type Command = {cmd: string; result: string}

export type Turn = {
  id: string
  kind: 'prompt' | 'reply'
  parentId: string | null
  text: string
  tokens: number
  status?: Status
  model?: string
  attachments?: Attachment[]
  // Reply: what the AI changed. Prompt: what the user changed in the folder since the previous Turn.
  files?: FileChange[]
  // Shell commands a Reply ran (Workspaces with the shell on).
  commands?: Command[]
  createdAt: number
  // Usage prototype: the Reply was refused because the Provider's usage limit was reached.
  limit?: LimitInfo
}

export type LimitInfo = {provider: string; window: string; until: number}

// Usage prototype hooks, set by the host app. Throw away.
export const usageHooks: {
  // The Model the next Prompt goes to; null keeps the parent's.
  model: string | null
  // A limit that refuses a new Reply on this Model, if any.
  gate: (model: string) => LimitInfo | null
  // A Reply's first request got through.
  started: (model: string) => void
  // The live sim, so a limit reached elsewhere can fail its running Replies.
  sim: {
    failRunning: (match: (t: Turn) => boolean, info: LimitInfo) => number
    streamingModels: () => string[]
  } | null
} = {model: null, gate: () => null, started: () => {}, sim: null}

export type Tree = Record<string, Turn>

export const estimateTokens = (text: string) =>
  Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length * 1.3))

const isTextFile = (a: Attachment) =>
  a.type.startsWith('text/') ||
  /\.(md|txt|csv|json|ts|tsx|js|py|html|css|ya?ml)$/i.test(a.name)

// Rough: a flat cost per image, ~4 bytes per token for text, and binaries like PDFs mostly aren't text.
export const attachmentTokens = (a: Attachment) =>
  a.type.startsWith('image/')
    ? 1500
    : Math.ceil(a.size / (isTextFile(a) ? 4 : 16))

export const promptTokens = (text: string, attachments: Attachment[] = []) =>
  (text.trim() ? estimateTokens(text) : 0) +
  attachments.reduce((sum, a) => sum + attachmentTokens(a), 0)

export const childrenOf = (tree: Tree, id: string | null) =>
  Object.values(tree)
    .filter(t => t.parentId === id)
    .sort((a, b) => a.createdAt - b.createdAt)

export const pathTo = (tree: Tree, id: string): Turn[] => {
  const path: Turn[] = []
  let cur: Turn | undefined = tree[id]
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? tree[cur.parentId] : undefined
  }
  return path
}

export const contextSize = (tree: Tree, replyId: string) =>
  pathTo(tree, replyId).reduce((sum, t) => sum + t.tokens, 0)

export const subtreeIds = (tree: Tree, id: string): string[] => [
  id,
  ...childrenOf(tree, id).flatMap(c => subtreeIds(tree, c.id)),
]

export const isFork = (tree: Tree, replyId: string) =>
  childrenOf(tree, replyId).length >= 2

// Every Turn below a collapsed Reply.
export const hiddenIds = (tree: Tree, collapsed: string[]) => {
  const hidden = new Set<string>()
  for (const id of collapsed)
    if (tree[id])
      for (const c of childrenOf(tree, id))
        for (const d of subtreeIds(tree, c.id)) hidden.add(d)
  return hidden
}

export const formatTokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

const respondable = (t: Turn) =>
  t.kind === 'reply' && (t.status === 'done' || t.status === 'stopped')

// Up to n respondable Replies, none on another's Thread, so each lands in its own Branch. Leaves first.
export const spreadReplies = (tree: Tree, n: number) => {
  const picked: string[] = []
  const candidates = Object.values(tree)
    .filter(respondable)
    .sort(
      (a, b) =>
        childrenOf(tree, a.id).length - childrenOf(tree, b.id).length ||
        b.createdAt - a.createdAt
    )
  for (const c of candidates) {
    if (picked.length === n) break
    const onPath = new Set(pathTo(tree, c.id).map(t => t.id))
    const related = picked.some(
      id => onPath.has(id) || pathTo(tree, id).some(t => t.id === c.id)
    )
    if (!related) picked.push(c.id)
  }
  return picked
}

// ---------- canned text ----------

const SHORT =
  "Sure. Short version: yes, that works, with one caveat about timing that I'd double-check before booking anything."

const MEDIUM = `Good question. There are three things worth weighing here.

First, the season. Late autumn is the busiest time of year, so trains and temples are crowded before 10am and after 3pm.

Second, where you stay. Staying near Kyoto Station makes day trips easy; staying in Higashiyama makes evenings nicer.

Third, pace. Two temples a day plus one long walk is a comfortable rhythm for most people.`

const LONG = `Here's a full 3-day plan, with the reasoning for each choice.

## Day 1: Higashiyama on foot

Start early at Kiyomizu-dera (it opens at 6am, and by 9am the approach is packed). Walk down through Sannenzaka and Ninenzaka, stopping for matcha somewhere along the lane. Late morning, head to Kodai-ji, then lunch near Yasaka Shrine.

In the afternoon, walk north along the base of the eastern hills to Nanzen-ji. The aqueduct behind the main gate is worth ten minutes. From there, the Philosopher's Path runs about two kilometres to Ginkaku-ji.

Evening: Gion. Walk Shirakawa-minami-dori around dusk, then Pontocho for dinner.

## Day 2: Arashiyama and the west

Take the JR Sagano line to Saga-Arashiyama. Go straight to the bamboo grove before 8am, then Tenryu-ji when it opens. Rent a bike if the weather is good; Okochi Sanso villa is expensive but quiet.

After lunch, take the train back toward the centre and visit Kinkaku-ji in the late afternoon, when the light hits the gold leaf.

\`\`\`
06:30  leave hotel
07:15  bamboo grove
08:30  Tenryu-ji
12:00  lunch (tofu, Yudofu Sagano)
15:30  Kinkaku-ji
\`\`\`

## Day 3: Fushimi Inari and Nishiki

Fushimi Inari first thing. Most visitors turn around at the Yotsutsuji intersection, about 45 minutes up; the view is best there anyway. Come down a different path through the quieter shrines.

Late morning, Tofuku-ji is one stop away and has one of the best garden sequences in the city.

Afternoon: Nishiki Market for grazing, then the Teramachi covered arcades for shopping. If you have energy left, the Kyoto Railway Museum is excellent even if you don't care about trains.

## Practical notes

- Get an ICOCA card for buses and trains.
- Buses are slow in peak season; walk or take the subway where possible.
- Many temples close gates at 4:30pm.
- Book a kaiseki dinner at least two weeks ahead.

If you tell me your budget and whether you're travelling with kids, I can tighten this up.`

const CANNED = [SHORT, MEDIUM, LONG, MEDIUM, SHORT]

// ---------- seed Tree ----------

const SEED_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd9b8"/><stop offset="1" stop-color="#f6a57a"/></linearGradient></defs>
<rect width="640" height="420" fill="url(#s)"/><circle cx="470" cy="150" r="52" fill="#fff4e0"/>
<path d="M0 300 L120 190 L230 280 L340 170 L470 290 L640 200 L640 420 L0 420Z" fill="#b5562f" opacity=".55"/>
<path d="M0 340 L160 260 L300 330 L450 250 L640 330 L640 420 L0 420Z" fill="#7a2f1d"/>
<g fill="#c8211b"><rect x="220" y="150" width="200" height="16" rx="4"/><rect x="232" y="180" width="176" height="10"/><rect x="250" y="160" width="16" height="200"/><rect x="374" y="160" width="16" height="200"/></g>
</svg>`
)}`

const SEED_ATTACHMENTS: Attachment[] = [
  {
    name: 'ryokan-room.svg',
    type: 'image/svg+xml',
    size: 1_180,
    url: SEED_PHOTO,
  },
  {
    name: 'booking-confirmation.pdf',
    type: 'application/pdf',
    size: 38_400,
    url: '',
  },
]

let seq = 0
const nextId = (kind: string) => `${kind[0]}${++seq}`

export type SimState = {
  tree: Tree
  activeReplyId: string
  // Replies whose descendants are hidden on the canvas.
  collapsed: string[]
  // Replies that failed this session and haven't been retried or jumped to yet.
  unseenFailures: string[]
  workspace: Workspace | null
  // The AI may also run commands, not just write files.
  shell: boolean
  // User edits made in a Thread's folder since its leaf Reply, keyed by that Reply.
  pendingEdits: Record<string, FileChange[]>
}

export type AddTurn = (
  kind: Turn['kind'],
  parentId: string | null,
  text: string,
  extra?: Partial<Turn>
) => string

// Builds a seed Tree; `build` adds Turns and returns the active Reply's id.
export function buildSeed(
  build: (add: AddTurn) => string,
  extra: Partial<SimState> = {}
): SimState {
  const tree: Tree = {}
  let clock = 0
  const add: AddTurn = (kind, parentId, text, extra = {}) => {
    const id = nextId(kind)
    tree[id] = {
      id,
      kind,
      parentId,
      text,
      tokens: promptTokens(text, extra.attachments),
      createdAt: ++clock,
      ...(kind === 'reply'
        ? {status: 'done' as const, model: 'Claude Sonnet 5'}
        : {}),
      ...extra,
    }
    return id
  }
  const activeReplyId = build(add)
  return {
    tree,
    activeReplyId,
    collapsed: [],
    unseenFailures: [],
    workspace: null,
    shell: false,
    pendingEdits: {},
    ...extra,
  }
}

export const CANNED_REPLIES = {SHORT, MEDIUM, LONG}

function seed(): SimState {
  return buildSeed(seedKyoto)
}

export function seedKyoto(add: AddTurn) {
  const p1 = add(
    'prompt',
    null,
    'Plan a 3-day trip to Kyoto for late November.'
  )
  const r1 = add('reply', p1, LONG)

  // A Fork: three Branches from the long plan.
  const p2 = add('prompt', r1, "Make it cheaper. We're on a tight budget.")
  const r2 = add('reply', p2, MEDIUM)
  const p3 = add('prompt', r1, 'Swap day 3 for a day trip to Nara.')
  const r3 = add('reply', p3, MEDIUM, {model: 'GPT-5.5'})
  const p4 = add('prompt', r1, 'What changes if we go in winter instead?')
  const r4 = add('reply', p4, MEDIUM.slice(0, 180), {status: 'stopped'})

  // A long pasted Prompt, to show the Prompt header scrolling.
  const p8 = add(
    'prompt',
    r1,
    `Before you rework the plan, here's everything we care about. Please keep all of it in mind.

Who's going: two adults and my mum, who's 72. She walks fine but can't do more than about 8,000 steps a day, and steep stairs are hard for her. No hikes up Fushimi Inari past the first few gates.

Budget: roughly $250 a day for the three of us, not counting the hotel. We'd rather spend on one great dinner than three okay ones.

Food: I'm vegetarian, my partner eats anything, and mum doesn't like spicy food. We'd love at least one shojin ryori temple meal.

Pace:
- Nothing before 9am, we're not early people
- A proper rest back at the hotel mid-afternoon
- No more than two big sights per day

Must-sees: Kiyomizu-dera, the autumn leaves somewhere quieter than Arashiyama, and a tea ceremony that isn't a tourist trap.

Skip: Nishiki Market (we went last time), anything with long queues, and the Golden Pavilion.

Getting around: taxis are fine for short hops, but we'd prefer buses or trains where it's easy. We land at Kansai at 2pm on day 1, so that day is light.`
  )
  add('reply', p8, MEDIUM)

  // A wide Fork: five quick Branches.
  const p5 = add('prompt', r2, 'Which hostel would you pick?')
  const r5 = add('reply', p5, SHORT)
  for (const q of [
    'Any free temples?',
    'Cheapest way from the airport?',
    'Is the bus pass worth it?',
    'Cheap eats near Nishiki?',
  ]) {
    const p = add('prompt', r2, q)
    add('reply', p, SHORT)
  }

  // A failed Reply, and a Thread continuing deeper.
  const p6 = add('prompt', r3, 'How long is the train from Kyoto to Nara?')
  add('reply', p6, 'About 45 minutes on the Kintetsu', {status: 'failed'})
  const p7 = add('prompt', r5, 'Book-ahead or walk-in?')
  const r7 = add('reply', p7, MEDIUM)
  const p9 = add(
    'prompt',
    r7,
    "Here's the room we're looking at and the booking confirmation. Will this work for mum?",
    {attachments: SEED_ATTACHMENTS}
  )
  return add('reply', p9, SHORT)
}

export const emptySim = (): SimState => ({
  tree: {},
  activeReplyId: '',
  collapsed: [],
  unseenFailures: [],
  workspace: null,
  shell: false,
  pendingEdits: {},
})

// ---------- per-Tree state cache, so switching Trees keeps each one ----------

const cache = new Map<string, SimState>()
const cacheListeners = new Set<() => void>()
let cacheVersion = 0
export const simCache = {
  get: (key: string) => cache.get(key),
  set(key: string, s: SimState) {
    cache.set(key, s)
    cacheVersion++
    cacheListeners.forEach(l => l())
  },
  subscribe(l: () => void) {
    cacheListeners.add(l)
    return () => {
      cacheListeners.delete(l)
    }
  },
  version: () => cacheVersion,
}

// A planned file change: applied once the stream reaches `atFraction` of its words.
export type PlannedChange = {
  atFraction: number
  make: (tree: Tree, replyId: string) => FileChange
}

export type SimOptions = {
  // Keys the cache; omit for a throwaway sim.
  key?: string
  init?: () => SimState
  // Decides which files a new Reply touches.
  planFiles?: (s: SimState, replyId: string) => PlannedChange[]
}

// How long a change shows as "writing" after it starts, in stream entries (word + whitespace).
const WRITING_ENTRIES = 30

const doneWriting = (turn: Turn): Turn =>
  turn.files?.some(f => f.writing)
    ? {...turn, files: turn.files.map(f => ({...f, writing: false}))}
    : turn

// ---------- simulation hook ----------

// Keeps the same array when nothing is removed, so unchanged collapse state doesn't re-trigger effects.
const without = (list: string[], remove: string[]) => {
  const out = list.filter(id => !remove.includes(id))
  return out.length === list.length ? list : out
}

// Strict ancestors, root first.
const ancestorsOf = (tree: Tree, id: string) =>
  pathTo(tree, id)
    .slice(0, -1)
    .map(t => t.id)

type Stream = {
  words: string[]
  i: number
  failAt: number | null
  // Fractional words owed to this stream; lets slow speeds emit less than one word per tick.
  owed: number
  // File changes still to apply, by stream entry index.
  planned: {at: number; make: PlannedChange['make']}[]
  // Entry index at which each applied change stops "writing", by path.
  writingUntil: Record<string, number>
}

export type Speed = 'slow' | 'normal' | 'fast'
const WORDS_PER_SECOND: Record<Speed, number> = {
  slow: 10,
  normal: 30,
  fast: 120,
}
const TICK_MS = 50

export type TreeSim = ReturnType<typeof useTreeSim>

export function useTreeSim(options: SimOptions = {}) {
  const {key, init = seed, planFiles} = options
  const [state, setState] = useState(() => (key && cache.get(key)) || init())
  const {
    tree,
    activeReplyId,
    collapsed,
    unseenFailures,
    workspace,
    shell,
    pendingEdits,
  } = state
  const stateRef = useRef(state)
  stateRef.current = state
  const planRef = useRef(planFiles)
  planRef.current = planFiles
  useEffect(() => {
    if (key) simCache.set(key, state)
  }, [key, state])
  // Streams don't survive a Tree switch, so leave them stopped in the cache.
  useEffect(
    () => () => {
      const s = key && cache.get(key)
      if (!s) return
      const tree = {...s.tree}
      for (const id of Object.keys(streams.current))
        if (tree[id]) tree[id] = doneWriting({...tree[id]!, status: 'stopped'})
      streams.current = {}
      simCache.set(key, {...s, tree})
    },
    [key]
  )
  const [failNext, setFailNext] = useState(false)
  const [focus, setFocus] = useState<{id: string; n: number} | null>(null)
  const [speed, setSpeed] = useState<Speed>('slow')
  const speedRef = useRef(speed)
  speedRef.current = speed
  const streams = useRef<Record<string, Stream>>({})

  const startStream = useCallback(
    (replyId: string) => {
      const text = CANNED[Math.floor(Math.random() * CANNED.length)]!
      const words = text.split(/(\s+)/)
      const s = stateRef.current
      const planned = (
        s.workspace && planRef.current ? planRef.current(s, replyId) : []
      ).map(p => ({
        at: Math.max(2, Math.floor((words.length * p.atFraction) / 2) * 2),
        make: p.make,
      }))
      streams.current[replyId] = {
        words,
        i: 0,
        owed: 0,
        failAt: failNext
          ? Math.floor(words.length * (0.2 + Math.random() * 0.5))
          : null,
        planned,
        writingUntil: {},
      }
      if (failNext) setFailNext(false)
    },
    [failNext]
  )

  useEffect(() => {
    const timer = setInterval(() => {
      const ids = Object.keys(streams.current)
      if (!ids.length) return
      const perTick = (WORDS_PER_SECOND[speedRef.current] * TICK_MS) / 1000
      setState(s => {
        const tree = {...s.tree}
        const failed: string[] = []
        let changed = false
        for (const id of ids) {
          const st = streams.current[id]!
          const turn = tree[id]
          if (!turn) {
            delete streams.current[id]
            continue
          }
          st.owed += perTick * (0.5 + Math.random())
          const n = Math.floor(st.owed)
          if (!n) continue
          st.owed -= n
          // words alternates word / whitespace, so n words is 2n entries.
          const chunk = st.words.slice(st.i, st.i + 2 * n).join('')
          st.i += 2 * n
          let status: Status = 'streaming'
          if (st.failAt !== null && st.i >= st.failAt) status = 'failed'
          else if (st.i >= st.words.length) status = 'done'
          const text = turn.text + chunk
          let files = turn.files
          for (const p of st.planned.filter(p => p.at <= st.i)) {
            const change = p.make(tree, id)
            st.writingUntil[change.path] = st.i + WRITING_ENTRIES
            files = [
              ...(files ?? []).filter(f => f.path !== change.path),
              {...change, at: text.length, writing: true},
            ]
          }
          st.planned = st.planned.filter(p => p.at > st.i)
          if (files?.some(f => f.writing && st.writingUntil[f.path]! <= st.i))
            files = files.map(f =>
              st.writingUntil[f.path]! <= st.i ? {...f, writing: false} : f
            )
          tree[id] = {
            ...turn,
            text,
            tokens: estimateTokens(text),
            status,
            ...(files ? {files} : {}),
          }
          if (status !== 'streaming') tree[id] = doneWriting(tree[id]!)
          changed = true
          if (status === 'failed') failed.push(id)
          if (status !== 'streaming') delete streams.current[id]
        }
        if (!changed) return s
        return {
          ...s,
          tree,
          unseenFailures: failed.length
            ? [...s.unseenFailures, ...failed]
            : s.unseenFailures,
        }
      })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // A null parent starts the Tree with a root Prompt.
  const submit = useCallback(
    (
      parentReplyId: string | null,
      text: string,
      attachments: Attachment[] = []
    ) => {
      const promptId = nextId('prompt')
      const replyId = nextId('reply')
      const now = Date.now()
      const model =
        usageHooks.model ||
        (parentReplyId && stateRef.current.tree[parentReplyId]?.model) ||
        'Claude Sonnet 5'
      const limit = usageHooks.gate(model)
      setState(s => ({
        ...s,
        activeReplyId: replyId,
        pendingEdits: parentReplyId
          ? Object.fromEntries(
              Object.entries(s.pendingEdits).filter(
                ([id]) => id !== parentReplyId
              )
            )
          : s.pendingEdits,
        // Sending from inside a collapsed Branch reveals it.
        collapsed: parentReplyId
          ? without(
              s.collapsed,
              pathTo(s.tree, parentReplyId).map(t => t.id)
            )
          : s.collapsed,
        tree: {
          ...s.tree,
          [promptId]: {
            id: promptId,
            kind: 'prompt',
            parentId: parentReplyId,
            text,
            tokens: promptTokens(text, attachments),
            ...(attachments.length ? {attachments} : {}),
            ...(parentReplyId && s.pendingEdits[parentReplyId]
              ? {files: s.pendingEdits[parentReplyId]}
              : {}),
            createdAt: now,
          },
          [replyId]: {
            id: replyId,
            kind: 'reply',
            parentId: promptId,
            text: '',
            tokens: 0,
            status: 'streaming',
            model,
            createdAt: now + 1,
            ...(limit ? {status: 'failed' as const, limit} : {}),
          },
        },
        unseenFailures: limit
          ? [...s.unseenFailures, replyId]
          : s.unseenFailures,
      }))
      if (!limit) {
        usageHooks.started(model)
        startStream(replyId)
      }
      setFocus(f => ({id: replyId, n: (f?.n ?? 0) + 1}))
      return replyId
    },
    [startStream]
  )

  const stop = useCallback((replyId: string) => {
    delete streams.current[replyId]
    setState(s => ({
      ...s,
      tree: {
        ...s.tree,
        [replyId]: doneWriting({...s.tree[replyId]!, status: 'stopped'}),
      },
    }))
  }, [])

  const retry = useCallback(
    (replyId: string, newModel?: string) => {
      const model = newModel ?? stateRef.current.tree[replyId]!.model!
      const limit = usageHooks.gate(model)
      if (!limit) usageHooks.started(model)
      setState(s => ({
        ...s,
        unseenFailures: without(s.unseenFailures, [replyId]),
        tree: {
          ...s.tree,
          [replyId]: {
            ...s.tree[replyId]!,
            text: '',
            tokens: 0,
            status: limit ? 'failed' : 'streaming',
            files: undefined,
            model,
            limit: limit ?? undefined,
          },
        },
      }))
      if (!limit) startStream(replyId)
    },
    [startStream]
  )

  // Usage prototype: a limit reached by another Reply refuses these Replies' next request; the text shown so far stays.
  useEffect(() => {
    const api = {
      failRunning: (match: (t: Turn) => boolean, info: LimitInfo) => {
        const ids = Object.keys(streams.current).filter(id => {
          const t = stateRef.current.tree[id]
          return t && match(t)
        })
        for (const id of ids) delete streams.current[id]
        if (ids.length)
          setState(s => {
            const tree = {...s.tree}
            for (const id of ids)
              tree[id] = doneWriting({
                ...tree[id]!,
                status: 'failed',
                limit: info,
              })
            return {...s, tree, unseenFailures: [...s.unseenFailures, ...ids]}
          })
        return ids.length
      },
      streamingModels: () =>
        Object.keys(streams.current).map(
          id => stateRef.current.tree[id]?.model ?? ''
        ),
    }
    usageHooks.sim = api
    return () => {
      if (usageHooks.sim === api) usageHooks.sim = null
    }
  }, [])

  const deleteFrom = useCallback((promptId: string) => {
    setState(s => {
      const ids = subtreeIds(s.tree, promptId)
      const tree = {...s.tree}
      for (const id of ids) {
        delete tree[id]
        delete streams.current[id]
      }
      let activeReplyId = s.activeReplyId
      if (!tree[activeReplyId]) {
        const replies = Object.values(tree).filter(
          t =>
            t.kind === 'reply' &&
            t.status !== 'failed' &&
            t.status !== 'streaming'
        )
        activeReplyId =
          replies.sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? ''
      }
      return {...s, tree, activeReplyId}
    })
  }, [])

  const reset = useCallback(() => {
    streams.current = {}
    setState(init())
  }, [init])

  const clear = useCallback(() => {
    streams.current = {}
    setState(s => ({...emptySim(), workspace: s.workspace, shell: s.shell}))
  }, [])

  const setWorkspace = useCallback(
    (workspace: Workspace | null, shell = false) =>
      setState(s => ({...s, workspace, shell})),
    []
  )

  // Simulates the user changing files in a Thread's folder between Turns; the next Prompt from that Reply records it.
  const userEdit = useCallback((replyId: string, change: FileChange) => {
    setState(s => ({
      ...s,
      pendingEdits: {
        ...s.pendingEdits,
        [replyId]: [
          ...(s.pendingEdits[replyId] ?? []).filter(
            f => f.path !== change.path
          ),
          change,
        ],
      },
    }))
  }, [])

  const toggleCollapsed = useCallback((replyId: string) => {
    setState(s => ({
      ...s,
      collapsed: s.collapsed.includes(replyId)
        ? without(s.collapsed, [replyId])
        : [...s.collapsed, replyId],
    }))
  }, [])

  // Expands every collapsed Reply above a Turn so it's on the canvas.
  const reveal = useCallback((turnId: string) => {
    setState(s => {
      const up = ancestorsOf(s.tree, turnId)
      return s.collapsed.some(id => up.includes(id))
        ? {...s, collapsed: without(s.collapsed, up)}
        : s
    })
  }, [])

  // Makes a Thread active without sending, so the canvas stays put.
  const activate = useCallback((replyId: string) => {
    setState(s =>
      s.activeReplyId === replyId ? s : {...s, activeReplyId: replyId}
    )
  }, [])

  const dismissFailure = useCallback((replyId: string) => {
    setState(s => ({
      ...s,
      unseenFailures: without(s.unseenFailures, [replyId]),
    }))
  }, [])

  return {
    tree,
    activeReplyId,
    failNext,
    setFailNext,
    speed,
    setSpeed,
    focus,
    submit,
    activate,
    stop,
    retry,
    deleteFrom,
    reset,
    clear,
    collapsed,
    toggleCollapsed,
    reveal,
    unseenFailures,
    dismissFailure,
    workspace,
    shell,
    setWorkspace,
    pendingEdits,
    userEdit,
  }
}
