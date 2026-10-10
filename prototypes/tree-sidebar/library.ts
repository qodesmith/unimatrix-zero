// PROTOTYPE: fake Tree library for the Tree sidebar ticket: metadata (pins, Collections, title source, activity), filler
// Trees with searchable text, auto-titles and full-text search. Throw away.
import {
  buildSeed,
  emptySim,
  simCache,
  type SimState,
  type Tree,
  type Turn,
} from '../canvas-mode-ux/tree'
import {seedLinkedRecipes, TREES} from '../workspace-file-tree/workspace'

export type TitleSource = 'prompt' | 'ai' | 'user'

export type Entry = {
  key: string
  init: () => SimState
  title: string
  // prompt = first line of the root Prompt (before the AI title arrives); ai = written by the AI; user = renamed.
  titleSource: TitleSource
  created: number
  lastActive: number
  pinned: boolean
  collection: string | null
}

const DAY = 86_400_000
const NOW = Date.now()
const ago = (days: number, hours = 0) => NOW - days * DAY - hours * 3_600_000

type Filler = {
  title: string
  days: number
  turns: [prompt: string, reply: string, model?: string][]
  collection?: string
  pinned?: boolean
  renamed?: boolean
}

const FILLER: Filler[] = [
  {
    title: 'Fractions homework help',
    days: 0.1,
    collection: 'School',
    turns: [
      [
        'Why is 1/2 bigger than 1/3 if 3 is bigger than 2?',
        'Think of a pizza. Cut it into 2 slices and each slice is huge. Cut the same pizza into 3 and each slice gets smaller. The bottom number says how many slices, so more slices means smaller pieces.',
      ],
      [
        'Can you give me 5 practice questions?',
        '1. Which is bigger, 1/4 or 1/5? 2. Put in order: 1/2, 1/8, 1/3. 3. Is 2/4 the same as 1/2? 4. What is 1/2 + 1/4? 5. Draw 3/4 of a chocolate bar.',
        'GPT-5.5',
      ],
    ],
  },
  {
    title: 'Toddler sleep regression',
    days: 0.3,
    pinned: true,
    turns: [
      [
        'My 18 month old suddenly wakes at 3am every night. What can I try?',
        'Eighteen-month sleep regressions are common and usually pass within two to six weeks. Keep the bedtime routine identical, avoid bringing new habits into the 3am wake-up, and check whether the afternoon nap has drifted too late.',
      ],
    ],
  },
  {
    title: 'Postgres connection pool exhaustion',
    days: 0.6,
    collection: 'Work',
    turns: [
      [
        'Our API pods hit "remaining connection slots are reserved" under load. 12 pods, pool size 20, max_connections 200.',
        '12 × 20 = 240 connections, more than max_connections. Put PgBouncer in transaction mode in front of Postgres, or drop each pool to about 12 and leave headroom for migrations and admin sessions.',
      ],
      [
        'Would PgBouncer break prepared statements?',
        'In transaction mode, server-side prepared statements break unless you use PgBouncer 1.21 or later with max_prepared_statements set, or disable them in the driver.',
        'GPT-5.5',
      ],
    ],
  },
  {
    title: 'Birthday party ideas for a 7 year old',
    days: 1.2,
    turns: [
      [
        'Dinosaur themed party for 12 kids in a small garden. Budget about $150.',
        'A fossil dig in a sandpit with plaster "bones", a dinosaur egg hunt (painted balloons filled with small toys), and a volcano cake with a baking soda eruption.',
      ],
    ],
  },
  {
    title: 'Learn Spanish: week 3',
    days: 1.6,
    collection: 'Learning',
    turns: [
      [
        'Quiz me on ser vs estar, 10 sentences.',
        '1. Mi madre ___ doctora. 2. La sopa ___ fría. 3. Nosotros ___ en Madrid. 4. El concierto ___ a las ocho...',
      ],
      [
        'Explain why the concert one uses ser',
        'Events use ser for where and when they take place: "El concierto es en el parque". Location of people and things uses estar.',
      ],
    ],
  },
  {
    title: 'Refactor billing service',
    days: 2.4,
    collection: 'Work',
    renamed: true,
    turns: [
      [
        'Here is our invoice generator. How would you split it so tax rules are testable?',
        'Pull the tax calculation into a pure function that takes line items and a jurisdiction and returns tax lines. The generator then just formats. Test the tax function with a table of cases per jurisdiction.',
      ],
    ],
  },
  {
    title: 'Vegetarian meal plan',
    days: 3,
    turns: [
      [
        'A week of vegetarian dinners, under 30 minutes, no mushrooms.',
        'Monday: chickpea curry with spinach. Tuesday: halloumi and roast vegetable traybake. Wednesday: black bean tacos...',
      ],
    ],
  },
  {
    title: 'Dragon story with Mia',
    days: 3.5,
    turns: [
      [
        'Write a story about a dragon who is scared of the dark, for my daughter Mia.',
        'Once upon a time, in a cave at the top of Pebble Mountain, lived a small green dragon named Flicker who could breathe fire but was afraid of the dark...',
      ],
      [
        'Mia wants the dragon to have a best friend',
        'One night a firefly named Glim flew into the cave. "Why are you hiding?" asked Glim. "Because it\'s dark," whispered Flicker...',
      ],
    ],
  },
  {
    title: 'Mortgage overpayment vs investing',
    days: 5,
    pinned: true,
    turns: [
      [
        'Mortgage at 4.1% fixed for 3 more years. Should I overpay or put the money into an index fund?',
        "Overpaying earns a guaranteed 4.1%. An index fund has historically returned more over long periods but with risk. It depends on your emergency fund, the early repayment cap, and how you'd feel about a bad year.",
      ],
    ],
  },
  {
    title: 'React Flow edge routing',
    days: 6,
    collection: 'Work',
    turns: [
      [
        'Edges overlap when a Fork has 8 children. Smoothstep or bezier?',
        'Smoothstep with an offset per sibling index keeps them apart. Compute the offset from the child order and pass it through edge data.',
      ],
    ],
  },
  {
    title: 'Garden: what to plant in autumn',
    days: 9,
    turns: [
      [
        'Clay soil, partly shaded. What can I plant in October?',
        'Spring bulbs (daffodils, alliums), hellebores for winter flowers, and garlic. Add compost to break up the clay.',
      ],
    ],
  },
  {
    title: 'Volcano science project',
    days: 12,
    collection: 'School',
    turns: [
      [
        'My son needs a volcano project that is more than baking soda.',
        'Pair the eruption with a cut-away model showing the magma chamber, vent and layers of ash and lava. Add a chart comparing shield and stratovolcanoes.',
      ],
    ],
  },
  {
    title: 'Kubernetes liveness probe flapping',
    days: 15,
    collection: 'Work',
    turns: [
      [
        'Pods restart every few minutes. Liveness probe hits /health with a 1s timeout.',
        'A 1s timeout during GC pauses or slow dependency checks restarts healthy pods. Make liveness cheap (process alive only), move dependency checks to readiness, and raise timeoutSeconds.',
      ],
    ],
  },
  {
    title: 'Cover letter for library job',
    days: 19,
    turns: [
      [
        'Help me write a cover letter for a part-time library assistant role. I have been home with kids for 6 years.',
        'Lead with what those years gave you: organising schedules, running the school book fair, patience with children. Libraries value community work.',
      ],
    ],
  },
  {
    title: 'Why is the sky blue',
    days: 24,
    turns: [
      [
        'why is the sky blue',
        'Sunlight is made of all colours. Blue light gets bounced around by the air much more than red light, so blue comes at your eyes from every part of the sky.',
      ],
    ],
  },
  {
    title: 'Japanese pitch accent',
    days: 33,
    collection: 'Learning',
    turns: [
      [
        'Is pitch accent worth learning as a beginner?',
        'Learn to hear it early, but do not drill it yet. Listening to native audio with pitch marks builds the instinct cheaply.',
      ],
    ],
  },
  {
    title: 'Car insurance renewal',
    days: 41,
    turns: [
      [
        'My renewal went up 38%. What should I check?',
        'Compare like for like: excess, named drivers, mileage. Then get quotes; insurers often reduce a renewal if you call with a cheaper quote.',
      ],
    ],
  },
  {
    title: 'Design doc: offline sync',
    days: 58,
    collection: 'Work',
    renamed: true,
    turns: [
      [
        'Outline a design doc for offline-first sync in our mobile app.',
        'Sections: goals and non-goals, data model (per-record version vectors), conflict policy, sync protocol, storage, migration, rollout, open questions.',
      ],
    ],
  },
  {
    title: 'Potty training tips',
    days: 77,
    turns: [
      [
        'When should we start potty training?',
        'Most children are ready between 2 and 3. Look for signs: staying dry for 2 hours, telling you when they need to go, interest in the toilet.',
      ],
    ],
  },
  {
    title: 'Solar system quiz',
    days: 96,
    collection: 'School',
    turns: [
      [
        'Make a solar system quiz for a 9 year old',
        '1. Which planet is closest to the Sun? 2. Which planet has the biggest rings? 3. Is Pluto a planet? ...',
      ],
    ],
  },
  {
    title: 'Rust lifetimes explained',
    days: 130,
    collection: 'Learning',
    turns: [
      [
        "I don't get 'a in fn longest<'a>(x: &'a str, y: &'a str) -> &'a str",
        "It says: the returned reference lives no longer than the shorter of x and y. The compiler can't guess which one you return, so you tell it they share a lifetime.",
      ],
    ],
  },
  {
    title: 'Wedding speech for my brother',
    days: 170,
    turns: [
      [
        'Best man speech, 4 minutes, funny but not embarrassing.',
        'Open with the time he got lost at his own surprise party, turn it into how he always finds his way to the people who matter, then a toast.',
      ],
    ],
  },
]

const fillerSeed = (f: Filler) => () =>
  buildSeed(add => {
    let parent: string | null = null
    let last = ''
    for (const [p, r, model] of f.turns) {
      const pid = add('prompt', parent, p)
      last = add('reply', pid, r, model ? {model} : {})
      parent = last
    }
    return last
  })

const SEEDED: Entry[] = TREES.map((t, i) => ({
  key: t.key,
  init: t.init,
  title: t.title,
  titleSource: 'ai',
  created: ago(4 + i * 7),
  lastActive: ago(0, 1 + i * 30),
  pinned: false,
  collection: t.key === 'recipes' ? 'Work' : null,
}))

// A linked folder deep in the user's disk, to see how a long path fits the Files badge.
const LONG_PATH: Entry = {
  key: 'long-path',
  init: () => {
    const s = seedLinkedRecipes()
    return {
      ...s,
      workspace: {
        ...(s.workspace as Extract<typeof s.workspace, {kind: 'linked'}>),
        path: '~/Documents/Clients/Hillside Primary School/2026 autumn term/website-rebuild',
      },
    }
  },
  title: 'School website rebuild',
  titleSource: 'ai',
  created: ago(8),
  lastActive: ago(0, 5),
  pinned: false,
  collection: 'Work',
}

export const INITIAL: Entry[] = [
  ...SEEDED,
  LONG_PATH,
  ...FILLER.map((f, i) => ({
    key: `filler-${i}`,
    init: fillerSeed(f),
    title: f.title,
    titleSource: (f.renamed ? 'user' : 'ai') as TitleSource,
    created: ago(f.days + 2),
    lastActive: ago(f.days),
    pinned: !!f.pinned,
    collection: f.collection ?? null,
  })),
]

export const INITIAL_COLLECTIONS = ['Work', 'School', 'Learning']

for (const e of INITIAL) simCache.set(e.key, e.init())

let newSeq = 0
export const newEntry = (): Entry => ({
  key: `new-${++newSeq}`,
  init: emptySim,
  title: '',
  titleSource: 'prompt',
  created: Date.now(),
  lastActive: Date.now(),
  pinned: false,
  collection: null,
})

// ---------- facts ----------

export const rootPrompt = (tree: Tree) =>
  Object.values(tree).find(t => !t.parentId)

export const displayTitle = (e: Entry) => {
  if (e.titleSource !== 'prompt') return e.title
  const root = rootPrompt(simCache.get(e.key)?.tree ?? {})
  return root?.text.split('\n')[0]?.trim() || 'New Tree'
}

export function stats(key: string) {
  const tree = simCache.get(key)?.tree ?? {}
  const turns = Object.values(tree)
  const forks = turns.filter(
    t => t.kind === 'reply' && turns.filter(c => c.parentId === t.id).length > 1
  ).length
  const providers = new Set(
    turns
      .filter(t => t.kind === 'reply')
      .map(t => (t.model?.startsWith('GPT') ? 'chatgpt' : 'claude'))
  )
  return {
    turns: turns.length,
    forks,
    providers: [...providers] as ('claude' | 'chatgpt')[],
    streaming: turns.some(t => t.status === 'streaming'),
    failed: (simCache.get(key)?.unseenFailures.length ?? 0) > 0,
  }
}

// Fake but plausible: what deleting this Tree frees (data it alone owns).
export function freesBytes(key: string) {
  const s = simCache.get(key)
  const n = s ? Object.keys(s.tree).length : 0
  const ws = !s?.workspace ? 0 : s.workspace.kind === 'linked' ? 412e6 : 38e6
  return n * 21_000 + (n > 10 ? 2.4e6 : 0) + ws
}

// ---------- the AI title ----------

// Stands in for a tiny title request to the Model after the first Reply finishes.
export function fakeAiTitle(prompt: string) {
  const words = prompt
    .split('\n')[0]!
    .replace(/^(please|can you|could you|help me|i want to|how do i)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .split(/\s+/)
    .slice(0, 5)
    .join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const firstReplyDone = (tree: Tree) => {
  const root = rootPrompt(tree)
  return Object.values(tree).some(
    t => t.parentId === root?.id && t.status === 'done'
  )
}

// ---------- search ----------

export type Hit = {turn: Turn; snippet: [string, string, string]}
export type TreeHits = {entry: Entry; titleHit: boolean; hits: Hit[]}

function snippetOf(text: string, at: number, len: number): Hit['snippet'] {
  const start = Math.max(0, at - 40)
  const end = Math.min(text.length, at + len + 60)
  return [
    (start > 0 ? '…' : '') + text.slice(start, at),
    text.slice(at, at + len),
    text.slice(at + len, end) + (end < text.length ? '…' : ''),
  ]
}

// Titles only, or every Turn's text too.
export function search(
  entries: Entry[],
  q: string,
  fullText: boolean
): TreeHits[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const out: TreeHits[] = []
  for (const entry of entries) {
    const titleHit = displayTitle(entry).toLowerCase().includes(needle)
    const hits: Hit[] = []
    if (fullText)
      for (const turn of Object.values(simCache.get(entry.key)?.tree ?? {})) {
        const at = turn.text.toLowerCase().indexOf(needle)
        if (at >= 0)
          hits.push({turn, snippet: snippetOf(turn.text, at, needle.length)})
      }
    if (titleHit || hits.length) out.push({entry, titleHit, hits})
  }
  return out.sort(
    (a, b) =>
      Number(b.titleHit) - Number(a.titleHit) ||
      b.entry.lastActive - a.entry.lastActive
  )
}

// ---------- time ----------

export function dateGroup(t: number) {
  const d = new Date(t)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = (today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / DAY
  if (days <= 0) return 'Today'
  if (days <= 1) return 'Yesterday'
  if (days <= 7) return 'Previous 7 days'
  if (days <= 30) return 'Previous 30 days'
  return d.getFullYear() === today.getFullYear()
    ? d.toLocaleString('en', {month: 'long'})
    : String(d.getFullYear())
}

export function relTime(t: number) {
  const m = Math.round((Date.now() - t) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString('en', {month: 'short', day: 'numeric'})
}
