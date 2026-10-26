import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {z} from 'zod'

// The unpinned `skills` CLI writes this file, so only entry names are read.
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
