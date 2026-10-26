import {$} from 'bun'
/**
 * Lists a repo's skills as JSON `{name, description, path}[]`, `path` relative
 * to the repo root. Mirrors `discoverSkills()` from vercel-labs/skills.
 *
 * Usage:
 * bun scripts/list-skills.ts <owner/repo | git URL | local path> [--full-depth]
 */
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, join, relative, sep} from 'node:path'
import {z} from 'zod'

import {lockedSkillNames} from './skills-lock.ts'

interface Skill {
  name: string
  description: string
  path: string
}

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__']
const CONTAINER_DEPTH = 3
const FALLBACK_DEPTH = 5

const AGENT_PROJECT_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.cline/skills',
  '.codebuddy/skills',
  '.codex/skills',
  '.commandcode/skills',
  '.continue/skills',
  '.factory/skills',
  '.github/skills',
  '.goose/skills',
  '.grok/skills',
  '.iflow/skills',
  '.junie/skills',
  '.kilo/skills',
  '.kilocode/skills',
  '.kimchi/skills',
  '.kiro/skills',
  '.minimax/skills',
  '.mux/skills',
  '.neovate/skills',
  '.opencode/skills',
  '.openhands/skills',
  '.pi/skills',
  '.posit/assistant/skills',
  '.qoder/skills',
  '.roo/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.zcode/skills',
  '.zencoder/skills',
]

const Frontmatter = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  metadata: z.looseObject({internal: z.unknown().optional()}).optional(),
})

function normalizeSkillName(name: string) {
  return name.toLowerCase().replaceAll(/[\s_]+/g, '-')
}

function sanitize(str: string) {
  return str.replaceAll(/[\r\n]+/g, ' ').trim()
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'SKILL.md'))).isFile()
  } catch {
    return false
  }
}

async function parseSkillMd(skillDir: string): Promise<Skill | null> {
  const skillMdPath = join(skillDir, 'SKILL.md')

  function warn(reason: string) {
    console.error(`⚠ Skipped ${skillMdPath} — ${reason}`)
  }

  let content: string

  try {
    content = await readFile(skillMdPath, 'utf8')
  } catch (err) {
    warn(`failed to read file: ${messageOf(err)}`)

    return null
  }

  let yaml = null

  const frontmatter = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
  )?.[1]

  if (frontmatter !== undefined) {
    try {
      yaml = Bun.YAML.parse(frontmatter)
    } catch (err) {
      warn(`YAML parse error: ${messageOf(err)}`)

      return null
    }
  }

  const parsed = Frontmatter.safeParse(yaml ?? {})

  if (!parsed.success) {
    warn('frontmatter "name" and "description" must be non-empty strings')

    return null
  }

  const {data} = parsed

  const includeInternal = ['1', 'true'].includes(
    process.env.INSTALL_INTERNAL_SKILLS ?? ''
  )

  if (data.metadata?.internal === true && !includeInternal) return null

  return {
    name: sanitize(data.name),
    description: sanitize(data.description),
    path: skillDir,
  }
}

async function readLockedSkillNames(basePath: string): Promise<Set<string>> {
  try {
    return new Set((await lockedSkillNames(basePath)).map(normalizeSkillName))
  } catch {
    return new Set()
  }
}

async function findSkillDirs(dir: string, depth = 0): Promise<string[]> {
  if (depth > FALLBACK_DEPTH) return []

  const [hasSkill, entries] = await Promise.all([
    hasSkillMd(dir),
    readdir(dir, {withFileTypes: true}).catch(() => []),
  ])

  const subDirResults = await Promise.all(
    entries
      .filter(entry => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))
      .map(async entry => findSkillDirs(join(dir, entry.name), depth + 1))
  )

  return [...(hasSkill ? [dir] : []), ...subDirResults.flat()]
}

export async function discoverSkills(
  basePath: string,
  {fullDepth = false} = {}
): Promise<Skill[]> {
  const skills: Skill[] = []
  const seenNames = new Set<string>()
  const parsedDirs = new Set<string>()
  const lockedNames = await readLockedSkillNames(basePath)

  function isInstalledProjectSkill(skill: Skill) {
    if (lockedNames.size === 0) return false
    const relativeDir = relative(basePath, skill.path).split(sep).join('/')

    const isAgentSkillPath = AGENT_PROJECT_SKILL_DIRS.some(
      dir => relativeDir === dir || relativeDir.startsWith(`${dir}/`)
    )

    return (
      isAgentSkillPath &&
      (lockedNames.has(normalizeSkillName(skill.name)) ||
        lockedNames.has(normalizeSkillName(basename(skill.path))))
    )
  }

  async function parseSkillAt(skillDir: string) {
    if (parsedDirs.has(skillDir)) return null
    parsedDirs.add(skillDir)

    return parseSkillMd(skillDir)
  }

  function addSkill(skill: Skill | null) {
    if (!skill || seenNames.has(skill.name) || isInstalledProjectSkill(skill)) {
      return
    }

    skills.push(skill)
    seenNames.add(skill.name)
  }

  if (await hasSkillMd(basePath)) {
    const skill = await parseSkillAt(basePath)

    if (skill && !isInstalledProjectSkill(skill)) {
      addSkill(skill)

      if (!fullDepth) return skills
    }
  }

  async function walkSkillDirs(dir: string, maxDepth: number, depth = 1) {
    let entries

    try {
      entries = await readdir(dir, {withFileTypes: true})
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const childDir = join(dir, entry.name)
      const foundAtChild = await hasSkillMd(childDir)

      if (foundAtChild) addSkill(await parseSkillAt(childDir))

      if (foundAtChild || depth >= maxDepth || SKIP_DIRS.includes(entry.name)) {
        continue
      }

      await walkSkillDirs(childDir, maxDepth, depth + 1)
    }
  }

  await walkSkillDirs(basePath, 1)

  const containerDirs = [
    'skills',
    'skills/.curated',
    'skills/.experimental',
    'skills/.system',
    ...AGENT_PROJECT_SKILL_DIRS,
  ]

  for (const dir of containerDirs) {
    await walkSkillDirs(join(basePath, dir), CONTAINER_DEPTH)
  }

  if (skills.length === 0 || fullDepth) {
    for (const skillDir of await findSkillDirs(basePath)) {
      addSkill(await parseSkillAt(skillDir))
    }
  }

  return skills
}

async function resolveSource(
  source: string
): Promise<{path: string; cleanup?: () => Promise<void>}> {
  if (await stat(source).catch(() => null)) return {path: source}

  const url = /^[\w.-]+\/[\w.-]+$/.test(source)
    ? `https://github.com/${source}.git`
    : source

  const dir = await mkdtemp(join(tmpdir(), 'list-skills-'))
  await $`git clone --quiet --depth 1 ${url} ${dir}`.quiet()

  return {
    path: dir,
    cleanup: async () => rm(dir, {recursive: true, force: true}),
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const source = args.find(arg => !arg.startsWith('--'))

  if (!source) {
    console.error(
      'Usage: bun scripts/list-skills.ts <owner/repo | git URL | local path> [--full-depth]'
    )
    process.exit(1)
  }

  const {path, cleanup} = await resolveSource(source)

  try {
    const skills = await discoverSkills(path, {
      fullDepth: args.includes('--full-depth'),
    })

    console.log(
      JSON.stringify(
        skills.map(skill => ({
          name: skill.name,
          description: skill.description,
          path: relative(path, skill.path).split(sep).join('/') || '.',
        })),
        null,
        2
      )
    )
  } finally {
    await cleanup?.()
  }
}
