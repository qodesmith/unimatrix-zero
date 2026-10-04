// PROTOTYPE: fake Workspaces, file snapshots and Segments for the Workspace file tree ticket. Throw away.
import {
  buildSeed,
  CANNED_REPLIES,
  childrenOf,
  emptySim,
  pathTo,
  seedKyoto,
  type FileChange,
  type FileOp,
  type PlannedChange,
  type SimState,
  type Tree,
  type Turn,
  type Workspace,
} from '../canvas-mode-ux/tree'

const {SHORT, MEDIUM, LONG} = CANNED_REPLIES

// ---------- snapshots ----------

export type FileState = {
  path: string
  content: string
  // The Turn that last changed it; null for files already in a linked folder.
  changedBy: string | null
}

// The Workspace as it was once a Turn finished: base folder, then every change on the way down.
export function snapshotAt(
  tree: Tree,
  turnId: string,
  workspace: Workspace | null,
  // User edits not yet sent with a Prompt (only meaningful at a Thread's leaf).
  pending: FileChange[] = []
) {
  const files = new Map<string, FileState>()
  if (workspace?.kind === 'linked')
    for (const [path, content] of Object.entries(workspace.base ?? {}))
      files.set(path, {path, content, changedBy: null})
  if (!tree[turnId]) return files
  for (const t of pathTo(tree, turnId))
    for (const f of t.files ?? [])
      if (f.op === 'deleted') files.delete(f.path)
      else
        files.set(f.path, {
          path: f.path,
          content: f.content ?? '',
          changedBy: t.id,
        })
  for (const f of pending)
    if (f.op === 'deleted') files.delete(f.path)
    else
      files.set(f.path, {
        path: f.path,
        content: f.content ?? '',
        changedBy: 'you',
      })
  return files
}

// The content a file had just before a Turn, e.g. to show what a deleted file was.
export function contentBefore(
  tree: Tree,
  turnId: string,
  path: string,
  workspace: Workspace | null
) {
  const parent = tree[turnId]?.parentId
  return parent
    ? snapshotAt(tree, parent, workspace).get(path)?.content
    : workspace?.kind === 'linked'
      ? workspace.base?.[path]
      : undefined
}

export const countOps = (files: FileChange[] = []) => ({
  added: files.filter(f => f.op === 'added').length,
  modified: files.filter(f => f.op === 'modified').length,
  deleted: files.filter(f => f.op === 'deleted').length,
})

export const OP_STYLE: Record<
  FileOp,
  {sign: string; text: string; bg: string; verb: string}
> = {
  added: {
    sign: '+',
    text: 'text-emerald-700',
    bg: 'bg-emerald-500',
    verb: 'Created',
  },
  modified: {
    sign: '~',
    text: 'text-amber-700',
    bg: 'bg-amber-500',
    verb: 'Edited',
  },
  deleted: {sign: '−', text: 'text-red-700', bg: 'bg-red-500', verb: 'Deleted'},
}

export type FileKind = 'md' | 'csv' | 'image' | 'pdf' | 'code' | 'text'
export function fileKind(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md') return 'md'
  if (ext === 'csv') return 'csv'
  if (['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['ts', 'tsx', 'js', 'json', 'css', 'html', 'py'].includes(ext))
    return 'code'
  return 'text'
}

export const baseName = (path: string) => path.split('/').pop() ?? path

export const isLeaf = (tree: Tree, replyId: string) =>
  childrenOf(tree, replyId).length === 0

// ---------- Segments: the linear stretch of a Thread between Forks ----------

export type Segment = {
  id: string
  turnIds: string[]
  // Last Reply: a Fork or a leaf.
  endReplyId: string
  parentSegmentId: string | null
  title: string
}

export function segmentsOf(tree: Tree): Segment[] {
  const out: Segment[] = []
  const walk = (prompt: Turn, parentSegmentId: string | null) => {
    const turnIds: string[] = []
    let p: Turn | undefined = prompt
    let end = ''
    while (p) {
      turnIds.push(p.id)
      const reply = childrenOf(tree, p.id)[0]
      if (!reply) break
      turnIds.push(reply.id)
      end = reply.id
      const next = childrenOf(tree, reply.id)
      p = next.length === 1 ? next[0] : undefined
    }
    const seg: Segment = {
      id: prompt.id,
      turnIds,
      endReplyId: end,
      parentSegmentId,
      title: prompt.text.split('\n')[0]!.slice(0, 40) || 'Attachments',
    }
    out.push(seg)
    const kids = end ? childrenOf(tree, end) : []
    if (kids.length >= 2) for (const k of kids) walk(k, seg.id)
  }
  for (const root of childrenOf(tree, null)) walk(root, null)
  return out
}

// ---------- seeds ----------

const ITINERARY = `# Kyoto in late November

Three days, two adults and mum (72).

## Day 1: Higashiyama
- Kiyomizu-dera at opening
- Sannenzaka and Ninenzaka lanes
- Dinner in Gion

## Day 2: Arashiyama
- Bamboo grove before 8am
- Tenryu-ji garden
- Kinkaku-ji in the late afternoon

## Day 3: Fushimi Inari and Nishiki
- Fushimi Inari, up to Yotsutsuji
- Tofuku-ji garden
- Nishiki Market`

const ITINERARY_CHEAP = ITINERARY.replace(
  'Dinner in Gion',
  'Dinner at a standing bar near Shijo (¥1,500 a head)'
)
  .replace(
    '- Tenryu-ji garden',
    '- Tenryu-ji garden (skip the villa, ¥1,000 saved)'
  )
  .concat(
    '\n\n## Money savers\n- One-day bus pass (¥700) on day 1 only\n- Konbini breakfasts\n- Free temples: Nanzen-ji grounds, Yasaka Shrine'
  )

const ITINERARY_NARA = ITINERARY.replace(
  /## Day 3[\s\S]*$/,
  `## Day 3: Nara day trip
- Kintetsu Limited Express from Kyoto (35 min)
- Todai-ji and the deer park
- Naramachi for lunch
- Back to Kyoto by 5pm`
)

const ITINERARY_MUM = ITINERARY.replace(
  '- Kiyomizu-dera at opening',
  '- Kiyomizu-dera at 9:30 (taxi to the top, walk down)'
)
  .replace(
    '- Fushimi Inari, up to Yotsutsuji',
    '- Fushimi Inari, first gates only'
  )
  .replace('- Nishiki Market', '- Shojin ryori lunch at Shigetsu')
  .concat('\n\nRest at the hotel every day from 2 to 4pm.')

const PACKING = `# Packing list

- Layers: it's 5–15°C
- Comfortable walking shoes
- ICOCA card
- Small towel (many toilets have no paper towels)
- Coin purse`

const BUDGET = `Item,Per day (¥),Days,Total (¥)
Hostel (3 beds),9000,3,27000
Food,6000,3,18000
Transport,1500,3,4500
Temples,2000,3,6000
Total,,,55500`

const SHORTLIST = `# Hostel shortlist

1. **Len Kyoto** — café downstairs, quiet rooms, ¥3,200 a bed
2. **Piece Hostel Sanjo** — private family room, lift
3. **K's House** — cheapest, but noisy at night`

const SHORTLIST_BOOK = `${SHORTLIST}

## Book ahead?
Yes. Late November sells out 3–4 weeks before. Book Piece Hostel's family room now; it's free to cancel until 3 days before.`

const NARA_TRAINS = `# Kyoto → Nara

| Train | Time | Price |
| Kintetsu Limited Express | 35 min | ¥1,280 |
| Kintetsu Express | 45 min | ¥760 |
| JR Nara line rapid | 45 min | ¥720 |`

const ROOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<rect width="640" height="420" fill="#efe6d4"/><rect x="40" y="260" width="560" height="120" fill="#c9b48a"/>
<rect x="80" y="60" width="200" height="180" fill="#f8f3e6" stroke="#8a6d3b" stroke-width="6"/>
<rect x="360" y="60" width="200" height="180" fill="#f8f3e6" stroke="#8a6d3b" stroke-width="6"/>
<rect x="200" y="300" width="240" height="40" rx="6" fill="#6b4f2a"/></svg>`

export function seedWorkspaceKyoto(): SimState {
  return buildSeed(
    add => {
      const p1 = add(
        'prompt',
        null,
        'Plan a 3-day trip to Kyoto for late November. Put the plan in a document I can print.'
      )
      const r1 = add('reply', p1, LONG, {
        files: [
          {path: 'itinerary.md', op: 'added', content: ITINERARY, at: 60},
          {path: 'packing-list.md', op: 'added', content: PACKING, at: 1900},
        ],
      })
      const p2 = add('prompt', r1, "Make it cheaper. We're on a tight budget.")
      const r2 = add('reply', p2, MEDIUM, {
        files: [
          {
            path: 'itinerary.md',
            op: 'modified',
            content: ITINERARY_CHEAP,
            at: 120,
          },
          {path: 'budget.csv', op: 'added', content: BUDGET, at: 300},
        ],
      })
      const p3 = add('prompt', r1, 'Swap day 3 for a day trip to Nara.')
      const r3 = add('reply', p3, MEDIUM, {
        model: 'GPT-5.5',
        files: [
          {
            path: 'itinerary.md',
            op: 'modified',
            content: ITINERARY_NARA,
            at: 200,
          },
          {
            path: 'nara/train-times.md',
            op: 'added',
            content: NARA_TRAINS,
            at: 380,
          },
        ],
      })
      const p4 = add('prompt', r1, 'What changes if we go in winter instead?')
      add('reply', p4, MEDIUM.slice(0, 180), {status: 'stopped'})
      const p8 = add(
        'prompt',
        r1,
        "Mum is 72 and can't do steep stairs or more than 8,000 steps a day. Rework the plan for her."
      )
      add('reply', p8, MEDIUM, {
        files: [
          {
            path: 'itinerary.md',
            op: 'modified',
            content: ITINERARY_MUM,
            at: 90,
          },
          {
            path: 'accessibility-notes.md',
            op: 'added',
            content:
              '# Accessibility notes\n\n- Kiyomizu-dera: taxi to the top gate\n- Fushimi Inari: first 200 m are flat\n- Most temples have a lift-free route; ask at the gate',
            at: 400,
          },
        ],
      })
      const p5 = add('prompt', r2, 'Which hostel would you pick?')
      const r5 = add('reply', p5, SHORT, {
        files: [
          {
            path: 'hostels/shortlist.md',
            op: 'added',
            content: SHORTLIST,
            at: 40,
          },
          {
            path: 'hostels/scratch.txt',
            op: 'added',
            content: 'len kyoto? piece? check lifts',
            at: 90,
          },
        ],
      })
      const pFree = add('prompt', r2, 'Any free temples?')
      add('reply', pFree, SHORT, {
        files: [
          {
            path: 'free-temples.md',
            op: 'added',
            content:
              '# Free temples\n\n- Nanzen-ji (grounds)\n- Yasaka Shrine\n- Fushimi Inari\n- Heian Shrine (grounds)',
            at: 50,
          },
        ],
      })
      for (const q of [
        'Cheapest way from the airport?',
        'Is the bus pass worth it?',
      ]) {
        const p = add('prompt', r2, q)
        add('reply', p, SHORT)
      }
      const p6 = add(
        'prompt',
        r3,
        'Add a lunch spot in Nara and book-ahead notes.'
      )
      add('reply', p6, 'Adding a lunch spot. Naramachi has', {
        status: 'failed',
        files: [
          {
            path: 'nara/lunch.md',
            op: 'added',
            content: '# Lunch in Nara\n\n- Kura (sake bar, lunch sets)',
            at: 20,
          },
        ],
      })
      const p7 = add('prompt', r5, 'Book-ahead or walk-in?')
      const r7 = add('reply', p7, MEDIUM, {
        files: [
          {
            path: 'hostels/shortlist.md',
            op: 'modified',
            content: SHORTLIST_BOOK,
            at: 150,
          },
          {path: 'hostels/scratch.txt', op: 'deleted', at: 400},
        ],
      })
      const p9 = add(
        'prompt',
        r7,
        "Here's the room we're looking at. I also added mum's medication to the packing list. Will this work for her?",
        {
          attachments: [
            {
              name: 'ryokan-room.svg',
              type: 'image/svg+xml',
              size: ROOM_SVG.length,
              url: `data:image/svg+xml,${encodeURIComponent(ROOM_SVG)}`,
            },
          ],
          // The user edited a file in this Thread's folder before sending.
          files: [
            {
              path: 'packing-list.md',
              op: 'modified',
              content: `${PACKING}\n- Mum's medication (and a copy of the prescription)`,
            },
          ],
        }
      )
      return add('reply', p9, SHORT, {
        files: [
          {
            path: 'photos/ryokan-room.svg',
            op: 'added',
            content: ROOM_SVG,
            at: 20,
          },
          {
            path: 'itinerary.md',
            op: 'modified',
            content: `${ITINERARY_CHEAP}\n\n## Where we stay\nPiece Hostel Sanjo, family room (lift, no stairs).`,
            at: 80,
          },
        ],
      })
    },
    {workspace: {kind: 'app'}}
  )
}

const SEARCH_TS = `export function search(recipes: Recipe[], query: string) {
  const q = query.toLowerCase()
  return recipes.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.ingredients.some(i => i.toLowerCase().includes(q))
  )
}`

const SEARCH_FAST = `const cache = new Map<string, Recipe[]>()

export function search(recipes: Recipe[], query: string) {
  const q = query.trim().toLowerCase()
  if (cache.has(q)) return cache.get(q)!
  const out = recipes.filter(r => r.searchText.includes(q))
  cache.set(q, out)
  return out
}`

const RECIPE_BASE: Record<string, string> = {
  'package.json':
    '{\n  "name": "recipe-site",\n  "scripts": {"dev": "vite", "test": "bun test"}\n}',
  'README.md': '# Recipe site\n\nFamily recipes, searchable.',
  'src/search.ts': SEARCH_TS,
  'src/legacy-search.ts': '// old search, unused\nexport {}',
  'src/filters.tsx':
    'export function Filters() {\n  return <div>Diet · Course</div>\n}',
  'src/App.tsx':
    "import {Filters} from './filters'\n\nexport function App() {\n  return <Filters />\n}",
}

export function seedLinkedRecipes(): SimState {
  return buildSeed(
    add => {
      const p1 = add(
        'prompt',
        null,
        'The search box on the recipes page is slow with 2,000 recipes. Can you fix it?'
      )
      const r1 = add('reply', p1, MEDIUM, {
        files: [
          {
            path: 'src/search.ts',
            op: 'modified',
            content: SEARCH_FAST,
            at: 150,
          },
          {
            path: 'src/search.test.ts',
            op: 'added',
            content:
              "import {search} from './search'\n\ntest('finds by ingredient', () => {\n  // …\n})",
            at: 330,
          },
        ],
        commands: [{cmd: 'bun test', result: '14 passed'}],
      })
      const p2 = add('prompt', r1, "Also add a 'cook time' filter.")
      const r2 = add('reply', p2, SHORT, {
        files: [
          {
            path: 'src/filters.tsx',
            op: 'modified',
            content:
              'export function Filters() {\n  return <div>Diet · Course · Cook time</div>\n}',
            at: 30,
          },
        ],
        commands: [{cmd: 'bun test', result: '15 passed'}],
      })
      const p3 = add(
        'prompt',
        r1,
        'Try a different approach: build a search index once instead.'
      )
      add('reply', p3, MEDIUM, {
        model: 'GPT-5.5',
        files: [
          {
            path: 'src/search-index.ts',
            op: 'added',
            content:
              'export function buildIndex(recipes: Recipe[]) {\n  // token → recipe ids\n}',
            at: 100,
          },
          {
            path: 'src/search.ts',
            op: 'modified',
            content:
              "import {buildIndex} from './search-index'\n\nexport const search = …",
            at: 250,
          },
          {path: 'src/legacy-search.ts', op: 'deleted', at: 380},
        ],
        commands: [
          {cmd: 'bun test', result: '1 failed, 13 passed'},
          {cmd: 'bun test', result: '14 passed'},
        ],
      })
      return r2
    },
    {
      workspace: {
        kind: 'linked',
        path: '~/code/recipe-site',
        base: RECIPE_BASE,
      },
      shell: true,
    }
  )
}

export const seedPlainKyoto = () => buildSeed(seedKyoto)

// Base files for a folder linked from the "Add a Workspace" dialog.
export const PICKED_FOLDER: Workspace = {
  kind: 'linked',
  path: '~/Documents/School search',
  base: {
    'schools.csv':
      'School,Distance,Rating\nHillside Primary,0.8 km,Good\nSt Anne’s,1.5 km,Outstanding',
    'notes.txt': 'Open days: Hillside 12 Nov, St Anne’s 19 Nov',
  },
}

export type TreeEntry = {key: string; init: () => SimState; title: string}

export const TREES: TreeEntry[] = [
  {key: 'kyoto-files', init: seedWorkspaceKyoto, title: 'Kyoto trip plan'},
  {key: 'recipes', init: seedLinkedRecipes, title: 'Recipe site search'},
  {key: 'kyoto-plain', init: seedPlainKyoto, title: 'Kyoto questions'},
]

export const newTreeEntry = (n: number): TreeEntry => ({
  key: `new-${n}`,
  init: emptySim,
  title: 'New Tree',
})

// ---------- what new Replies write ----------

let noteSeq = 0
export function planFiles(s: SimState): PlannedChange[] {
  const linked =
    s.workspace?.kind === 'linked' && !!s.workspace.base?.['src/search.ts']
  const append =
    (path: string, fallback: string, extra: string): PlannedChange['make'] =>
    (tree, replyId) => {
      const cur = snapshotAt(tree, replyId, s.workspace).get(path)?.content
      return cur === undefined
        ? {path, op: 'added', content: fallback}
        : {path, op: 'modified', content: `${cur}\n${extra}`}
    }
  if (linked)
    return [
      {
        atFraction: 0.35,
        make: append('src/search.ts', SEARCH_TS, '// tweaked'),
      },
      ...(Math.random() < 0.5
        ? [
            {
              atFraction: 0.7,
              make: append('CHANGELOG.md', '# Changelog\n', '- Faster search'),
            },
          ]
        : []),
    ]
  const n = ++noteSeq
  const plans: PlannedChange[] = [
    {
      atFraction: 0.3,
      make: append(
        'itinerary.md',
        '# Plan\n',
        `\n## Update ${n}\n- Adjusted after your last message`
      ),
    },
  ]
  if (Math.random() < 0.6)
    plans.push({
      atFraction: 0.7,
      make: () => ({
        path: `notes/note-${n}.md`,
        op: 'added',
        content: `# Note ${n}\n\nThings to check before booking.`,
      }),
    })
  return plans
}
