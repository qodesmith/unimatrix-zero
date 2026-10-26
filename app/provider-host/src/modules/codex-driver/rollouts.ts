import type {AppServer} from './app-server'
import type {ResponseOf} from './wire'
import type {SessionFile, SessionFolder} from '@uz/contract/host'

import fs from 'node:fs'
import path from 'node:path'

export function folderOf(threadId: string): SessionFolder {
  return {projectKey: 'codex', sessionId: threadId}
}

/** `file` relative to `home` with `/` between parts; null outside it. */
function relativeIn(home: string, file: string) {
  const relative = path.relative(home, fs.realpathSync(file))

  if (relative.startsWith('..') || path.isAbsolute(relative)) return null

  return relative.split(path.sep).join('/')
}

/**
 * The thread's and its fork ancestors' rollouts, by path in `CODEX_HOME`. Codex
 * reports each one's file and parent, so the files are never read (ADR 0004).
 */
export async function readRollouts(
  server: Pick<AppServer, 'request'>,
  codexHome: string,
  threadId: string
): Promise<SessionFile[]> {
  const home = fs.realpathSync(codexHome)
  const files: SessionFile[] = []
  const seen = new Set<string>()
  let next: string | null = threadId

  while (next !== null && !seen.has(next)) {
    seen.add(next)

    const {thread}: ResponseOf<'thread/read'> = await server.request(
      'thread/read',
      {threadId: next}
    )

    const relative = thread.path === null ? null : relativeIn(home, thread.path)

    if (relative !== null) {
      files.push({
        path: relative,
        base64: fs.readFileSync(path.join(home, relative)).toString('base64'),
      })
    }

    next = thread.forkedFromId
  }

  return files
}

/**
 * A plain rollout on disk that starts with the saved copy is the same thread
 * carried further, such as by a turn the app quit in before saving.
 */
function carriedFurther(target: string, saved: Buffer) {
  if (!fs.existsSync(target)) return false

  return fs.readFileSync(target).subarray(0, saved.length).equals(saved)
}

/**
 * Codex rewrites a compressed rollout it resumes as plain `.jsonl`, so when
 * both names are kept the `.zst` is the older and left out.
 */
export function writeRolloutsBack(codexHome: string, files: SessionFile[]) {
  const names = new Set(files.map(file => file.path))

  for (const file of files) {
    if (file.path.endsWith('.zst') && names.has(file.path.slice(0, -4))) {
      continue
    }

    const target = path.resolve(codexHome, ...file.path.split('/'))

    if (!target.startsWith(`${path.resolve(codexHome)}${path.sep}`)) continue

    const saved = Buffer.from(file.base64, 'base64')

    if (!file.path.endsWith('.zst') && carriedFurther(target, saved)) continue

    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700})
    fs.writeFileSync(target, saved, {mode: 0o600})
  }
}
