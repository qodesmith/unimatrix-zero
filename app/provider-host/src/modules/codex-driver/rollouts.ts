import type {AppServer} from './app-server'
import type {ResponseOf} from './wire'
import type {SessionFile, SessionFolder} from '@uz/contract/host'

import fs from 'node:fs'
import path from 'node:path'

/** Where the app keeps Codex's Threads: one folder per Codex thread. */
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
 * The thread's rollout and the rollout of every ancestor a fork points into,
 * as Codex has them now, by their names under `CODEX_HOME` (ADR 0004). Codex
 * reports each one's file and parent; the files are never read for either.
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
 * Writes the kept rollouts back under their original names before Codex
 * resumes the thread. Codex rewrites a compressed rollout it resumes as plain
 * `.jsonl`, so when both names are kept the plain one is the newer and the
 * `.zst` is left out. A path that would land outside `CODEX_HOME` is skipped.
 */
export function writeRolloutsBack(codexHome: string, files: SessionFile[]) {
  const names = new Set(files.map(file => file.path))

  for (const file of files) {
    if (file.path.endsWith('.zst') && names.has(file.path.slice(0, -4))) {
      continue
    }

    const target = path.resolve(codexHome, ...file.path.split('/'))

    if (!target.startsWith(`${path.resolve(codexHome)}${path.sep}`)) continue

    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700})
    fs.writeFileSync(target, Buffer.from(file.base64, 'base64'), {mode: 0o600})
  }
}
