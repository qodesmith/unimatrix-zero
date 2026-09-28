// PROTOTYPE: fake Tree + timer-faked streaming for the Canvas mode UX ticket. Throw away.
import {useCallback, useEffect, useRef, useState} from 'react'

export type Status = 'streaming' | 'done' | 'stopped' | 'failed'

export type Turn = {
  id: string
  kind: 'prompt' | 'reply'
  parentId: string | null
  text: string
  tokens: number
  status?: Status
  model?: string
  createdAt: number
}

export type Tree = Record<string, Turn>

export const estimateTokens = (text: string) =>
  Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length * 1.3))

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

let seq = 0
const nextId = (kind: string) => `${kind[0]}${++seq}`

function seed(): {tree: Tree; activeReplyId: string} {
  seq = 0
  const tree: Tree = {}
  let clock = 0
  const add = (
    kind: Turn['kind'],
    parentId: string | null,
    text: string,
    extra: Partial<Turn> = {}
  ) => {
    const id = nextId(kind)
    tree[id] = {
      id,
      kind,
      parentId,
      text,
      tokens: estimateTokens(text),
      createdAt: ++clock,
      ...(kind === 'reply'
        ? {status: 'done' as const, model: 'Claude Sonnet 5'}
        : {}),
      ...extra,
    }
    return id
  }

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

  return {tree, activeReplyId: r7}
}

// ---------- simulation hook ----------

type Stream = {
  words: string[]
  i: number
  failAt: number | null
  // Fractional words owed to this stream; lets slow speeds emit less than one word per tick.
  owed: number
}

export type Speed = 'slow' | 'normal' | 'fast'
const WORDS_PER_SECOND: Record<Speed, number> = {
  slow: 10,
  normal: 30,
  fast: 120,
}
const TICK_MS = 50

export type TreeSim = ReturnType<typeof useTreeSim>

export function useTreeSim() {
  const [state, setState] = useState(seed)
  const {tree, activeReplyId} = state
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
      streams.current[replyId] = {
        words,
        i: 0,
        owed: 0,
        failAt: failNext
          ? Math.floor(words.length * (0.2 + Math.random() * 0.5))
          : null,
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
          tree[id] = {...turn, text, tokens: estimateTokens(text), status}
          changed = true
          if (status !== 'streaming') delete streams.current[id]
        }
        return changed ? {...s, tree} : s
      })
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const submit = useCallback(
    (parentReplyId: string, text: string) => {
      const promptId = nextId('prompt')
      const replyId = nextId('reply')
      const now = Date.now()
      setState(s => ({
        activeReplyId: replyId,
        tree: {
          ...s.tree,
          [promptId]: {
            id: promptId,
            kind: 'prompt',
            parentId: parentReplyId,
            text,
            tokens: estimateTokens(text),
            createdAt: now,
          },
          [replyId]: {
            id: replyId,
            kind: 'reply',
            parentId: promptId,
            text: '',
            tokens: 0,
            status: 'streaming',
            model: s.tree[parentReplyId]?.model ?? 'Claude Sonnet 5',
            createdAt: now + 1,
          },
        },
      }))
      startStream(replyId)
      setFocus(f => ({id: replyId, n: (f?.n ?? 0) + 1}))
      return replyId
    },
    [startStream]
  )

  const stop = useCallback((replyId: string) => {
    delete streams.current[replyId]
    setState(s => ({
      ...s,
      tree: {...s.tree, [replyId]: {...s.tree[replyId]!, status: 'stopped'}},
    }))
  }, [])

  const retry = useCallback(
    (replyId: string) => {
      setState(s => ({
        ...s,
        tree: {
          ...s.tree,
          [replyId]: {
            ...s.tree[replyId]!,
            text: '',
            tokens: 0,
            status: 'streaming',
          },
        },
      }))
      startStream(replyId)
    },
    [startStream]
  )

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
      return {tree, activeReplyId}
    })
  }, [])

  const reset = useCallback(() => {
    streams.current = {}
    setState(seed())
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
    stop,
    retry,
    deleteFrom,
    reset,
  }
}
