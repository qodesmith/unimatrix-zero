// PROTOTYPE: extra Trees for the ⌘K search ticket (#44), so ranking and grouping have something to chew on: words that
// recur across Trees (sleep, pizza, budget, dragon), accents (café), an attachment name, a long Thread with many matches,
// and a Fork. Appended to the Tree sidebar's library at import time. Throw away.
import {buildSeed, simCache, type SimState} from '../canvas-mode-ux/tree'
import {INITIAL, type Entry} from '../tree-sidebar/library'

const DAY = 86_400_000
const ago = (days: number) => Date.now() - days * DAY

type Step = [prompt: string, reply: string, model?: string, attachment?: string]

const tree =
  (steps: Step[], fork?: {at: number; steps: Step[]}) => (): SimState =>
    buildSeed(add => {
      let parent: string | null = null
      const replies: string[] = []
      for (const [p, r, model, file] of steps) {
        const pid: string = add(
          'prompt',
          parent,
          p,
          file
            ? {
                attachments: [
                  {name: file, type: 'application/pdf', size: 84_000, url: ''},
                ],
              }
            : {}
        )
        parent = add('reply', pid, r, model ? {model} : {})
        replies.push(parent)
      }
      if (fork) {
        let fp: string = replies[fork.at]!
        for (const [p, r, model] of fork.steps) {
          const pid = add('prompt', fp, p)
          fp = add('reply', pid, r, model ? {model} : {})
        }
      }
      return parent!
    })

const EXTRA: (Omit<Entry, 'key' | 'pinned' | 'titleSource'> & {key: string})[] =
  [
    {
      key: 'search-sleep-teen',
      title: 'Teen screens and sleep',
      created: ago(40),
      lastActive: ago(12),
      collection: null,
      init: tree([
        [
          'My 14-year-old is on her phone until 1am. How much sleep does a teenager actually need?',
          'Most teens need 8 to 10 hours of sleep. Phones hurt sleep twice: the light delays melatonin, and the scrolling keeps the brain alert. A phone basket outside the bedroom at 10pm is the single most effective change families report.',
          'GPT-5.5',
        ],
        [
          'She says she needs it as an alarm.',
          'A £6 alarm clock solves that. Frame it as a family rule, not a punishment: parents put their phones in the basket too.',
          'GPT-5.5',
        ],
      ]),
    },
    {
      key: 'search-pizza-party',
      title: 'Pizza party for an 8-year-old',
      created: ago(6),
      lastActive: ago(2),
      collection: null,
      init: tree([
        [
          'Planning a pizza party for 10 kids turning 8. Can they make their own pizzas?',
          'Yes, and it doubles as the activity. Pre-make small dough balls, set out sauce, cheese and three toppings, and bake in two batches. Budget about 25 minutes of oven time.',
        ],
        [
          'Here is the dough recipe I usually use, will it scale?',
          'It scales fine to 10 small pizzas. Double it, and let the dough rest at least an hour so little hands can stretch it without tearing.',
          undefined,
          'pizza-dough-recipe.pdf',
        ],
      ]),
    },
    {
      key: 'search-paris-cafes',
      title: 'Paris café list',
      created: ago(20),
      lastActive: ago(19),
      collection: 'Learning',
      init: tree([
        [
          'Which cafés in Paris are worth the queue? We like quiet places to read.',
          'For quiet reading: Café de Flore early in the morning before the tourists, Shakespeare and Company’s café for the books, and Le Peloton Café in the Marais for excellent coffee. Avoid Les Deux Magots at lunch.',
        ],
        [
          'How do I order a flat white in French?',
          'Many Paris cafés now just say “flat white”. If not, ask for “un café crème, pas trop de lait”, which is close.',
        ],
      ]),
    },
    {
      key: 'search-family-budget',
      title: 'Family budget spreadsheet',
      created: ago(90),
      lastActive: ago(3),
      collection: null,
      init: tree(
        [
          [
            'Help me set up a monthly family budget. Two incomes, two kids, a mortgage.',
            'Start with four columns: income, fixed costs (mortgage, insurance, childcare), flexible costs (food, petrol, fun) and savings. Put savings first so it isn’t what’s left over.',
          ],
          [
            'Our food budget keeps blowing up. Any ideas?',
            'Plan five dinners a week, shop once with a list, and cook one big batch on Sunday. Most families cut their food budget by 20% just from fewer top-up shops.',
          ],
          [
            'What about a budget for the kids’ activities?',
            'Give each child a yearly activities budget and let them choose within it. It teaches trade-offs and keeps the total predictable.',
            'GPT-5.5',
          ],
          [
            'Can you turn all this into a sleep-friendly bedtime routine for the kids too?',
            'Different topic, but sure: bath at 7, books at 7:20, lights out at 7:45. Consistency matters more than the exact times.',
          ],
        ],
        {
          at: 1,
          steps: [
            [
              'Actually, compare budget apps instead of a spreadsheet.',
              'YNAB is strict and great for envelope budgeting; Emma and Snoop are free and read your bank automatically. A spreadsheet still wins if you want full control of the budget.',
            ],
          ],
        }
      ),
    },
    {
      key: 'search-komodo',
      title: 'Komodo dragons school report',
      created: ago(15),
      lastActive: ago(14),
      collection: 'School',
      init: tree([
        [
          'I have to write a report on Komodo dragons. Are they real dragons?',
          'Not dragons, but the largest lizards alive: up to 3 metres long. They live on a few Indonesian islands and can smell food from several kilometres away.',
          'GPT-5.5',
        ],
        [
          'Do Komodo dragons breathe fire?',
          'No fire! But their bite has venom that stops blood clotting. That’s the most dragon-like thing about them.',
          'GPT-5.5',
        ],
      ]),
    },
    {
      key: 'search-postgres-long',
      title: 'Postgres upgrade runbook',
      created: ago(30),
      lastActive: ago(1),
      collection: 'Work',
      init: tree([
        [
          'We are upgrading Postgres 14 to 17. Draft a runbook.',
          'Phases: 1) test pg_upgrade on a snapshot, 2) check extensions, 3) put PgBouncer in pause mode, 4) run pg_upgrade --link, 5) analyze, 6) resume PgBouncer.',
        ],
        [
          'How long will PgBouncer pause hold connections?',
          'PgBouncer queues clients while paused, up to query_wait_timeout (default 120 s). Keep the upgrade window under that or raise it for the night.',
        ],
        [
          'What if pg_upgrade fails halfway?',
          'With --link you can’t start the old cluster once the new one has started. Before that point, just resume PgBouncer on the old cluster.',
        ],
        [
          'Add a rollback section.',
          'Rollback: keep the pre-upgrade snapshot for 7 days. If you need it, point PgBouncer at a replica restored from that snapshot and replay WAL up to the failure.',
        ],
        [
          'And a checklist for the on-call engineer.',
          '☐ Snapshot taken ☐ Extensions checked ☐ PgBouncer paused ☐ pg_upgrade run ☐ ANALYZE done ☐ PgBouncer resumed ☐ Error rates normal for 30 minutes.',
        ],
      ]),
    },
  ]

for (const e of EXTRA) {
  const entry: Entry = {...e, pinned: false, titleSource: 'ai'}
  INITIAL.push(entry)
  simCache.set(entry.key, entry.init())
}
