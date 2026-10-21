import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

// The `skills` CLI writes this file and isn't pinned, so entries stay loose:
// only their names are read.
const SkillsLock = z.looseObject({
  skills: z.record(z.string(), z.looseObject({})),
})

/** The names of the skills installed from `skills-lock.json` in `dir`. */
export async function lockedSkillNames(dir: string) {
  const lock = SkillsLock.parse(
    JSON.parse(await readFile(join(dir, 'skills-lock.json'), 'utf8'))
  )

  return Object.keys(lock.skills)
}
