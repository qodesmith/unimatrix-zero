/**
 * Every file in the repo is written in US English, except the skills installed
 * from `skills-lock.json`, which keep their authors' spelling.
 */
import {$} from 'bun'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const self = path.relative(root, import.meta.path)

// US words that only look like the UK -ise spelling.
const US_ISE = new Set([
  'advertise',
  'advise',
  'appraise',
  'apprise',
  'arise',
  'braise',
  'bruise',
  'chaise',
  'chastise',
  'circumcise',
  'comprise',
  'compromise',
  'concise',
  'crise',
  'cruise',
  'demise',
  'depcruise',
  'despise',
  'devise',
  'disenfranchise',
  'disguise',
  'enfranchise',
  'enterprise',
  'excise',
  'exercise',
  'expertise',
  'franchise',
  'guise',
  'imprecise',
  'improvise',
  'incise',
  'irise',
  'liaise',
  'merchandise',
  'noise',
  'paradise',
  'poise',
  'porpoise',
  'praise',
  'precise',
  'premise',
  'promise',
  'raise',
  'reprise',
  'revise',
  'rise',
  'sunrise',
  'supervise',
  'surmise',
  'surprise',
  'televise',
  'tortoise',
  'treatise',
  'turquoise',
  'valise',
])

type Rule = [
  pattern: RegExp,
  us: string,
  allow?: (match: RegExpMatchArray) => boolean,
]

const RULES: Rule[] = [
  [
    /\b(colo|behavio|favo|hono|labo|flavo|neighbo|harbo|humo|rumo|armo|endeavo|vapo|savo|parlo|odo|rigo|vigo|tumo|splendo|cando)ur(\w*)\b/gi,
    '$1r$2',
  ],
  [/\b(cent|fib|theat|lit|calib|somb|spect|lust|met)re(s?)\b/gi, '$1er$2'],
  [/\b(cent|fib|theat|lit|calib|met)r(ed|ing)\b/gi, '$1er$2'],
  [
    /\b(\w+)is(e|es|ed|ing|ation|ations|er|ers)\b/gi,
    '$1iz$2',
    ([, stem]) => US_ISE.has(`${stem}ise`.toLowerCase()) || /w$/i.test(stem!),
  ],
  [/\b(analy|paraly|cataly|dialy|electroly|hydroly)s(e|ed|ing)\b/gi, '$1z$2'],
  [
    /\b(label|cancel|model|travel|level|signal|channel|tunnel|fuel|total|marshal|counsel|dial|panel|funnel|jewel|bevel|marvel|quarrel|libel|equal|pedal|rival|unravel|initial|duel|refuel|remodel|relabel)l(ed|ing|er|ers)\b/gi,
    '$1$2',
  ],
  [/\bfocuss(ed|es|ing)\b/gi, 'focus$1'],
  [/\bgrey(s|ed|ing|scale)?\b/gi, 'gray$1'],
  [/\bjudgement(s?)\b/gi, 'judgment$1'],
  [/\bageing\b/gi, 'aging'],
  [/\bartefact(s?)\b/gi, 'artifact$1'],
  [/\bwhilst\b/gi, 'while'],
  [/\bamongst\b/gi, 'among'],
  [/\blearnt\b/gi, 'learned'],
  [/\bspelt\b/gi, 'spelled'],
  [/\b(to|after|back|up|down)wards\b/gi, '$1ward'],
  [/\blicence(s?)\b/gi, 'license$1'],
  [/\b(defen|offen|preten)ce(s?)\b/gi, '$1se$2'],
  [/\b(catalo|analo)gue(s|d)?\b/gi, '$1g$2'],
  [/\bprogramme(s?)\b/gi, 'program$1'],
  [/\b(enrol|fulfil|instal)ment(s?)\b/gi, '$1lment$2'],
  [/\b(enrol|fulfil)(s?)\b/gi, '$1l$2'],
  [/\b(skil|wil)ful(ly)?\b/gi, '$1lful$2'],
  [/\bsceptic(\w*)\b/gi, 'skeptic$1'],
  [/\bmanoeuvre(s|d)?\b/gi, 'maneuver$1'],
  [/\bpractis(e|es|ed|ing)\b/gi, 'practic$1'],
  [/\baluminium\b/gi, 'aluminum'],
  [/\bcosy\b/gi, 'cozy'],
  [/\bmould(s|ed|ing|y)?\b/gi, 'mold$1'],
  [/\bspeciality\b/gi, 'specialty'],
  [/\bmaths\b/gi, 'math'],
  [/\benquir(e|es|ed|ing|y|ies)\b/gi, 'inquir$1'],
  [/\borientated\b/gi, 'oriented'],
  [/\bdraught(s?)\b/gi, 'draft$1'],
]

const lock: {skills: Record<string, unknown>} = await Bun.file(
  path.join(root, 'skills-lock.json')
).json()
const installedSkills = Object.keys(lock.skills).flatMap(name => [
  `.agents/skills/${name}`,
  `.claude/skills/${name}`,
])
const skipped = (file: string) =>
  file === self ||
  file === 'bun.lock' ||
  installedSkills.some(dir => file === dir || file.startsWith(`${dir}/`))

const files = (await $`git ls-files -co --exclude-standard`.cwd(root).text())
  .split('\n')
  .filter(file => file && !skipped(file))

const problems: string[] = []
for (const file of files) {
  const handle = Bun.file(path.join(root, file))
  if (!(await handle.exists())) continue
  const lines = (await handle.text()).split('\n')
  lines.forEach((line, index) => {
    for (const [pattern, us, allow] of RULES) {
      for (const match of line.matchAll(pattern)) {
        if (allow?.(match)) continue
        problems.push(
          `${file}:${index + 1}: ${match[0]} → ${match[0].replace(new RegExp(pattern.source, 'i'), us)}`
        )
      }
    }
  })
}

if (problems.length > 0) {
  console.error('UK spellings (use US English):\n' + problems.join('\n'))
  process.exit(1)
}
console.log('Spelling is US English.')
