import type {Database} from '#modules/database/main'
import type {ReplySession} from '@uz/contract/host'

import {schema} from '#modules/database/main'
import {and, eq, gt} from 'drizzle-orm'
import {alias} from 'drizzle-orm/sqlite-core'

const {compactions, sessionEntries} = schema

const boundaries = alias(sessionEntries, 'boundaries')

/**
 * Whether the session's own transcript compacted after the entry `uuid`. Only
 * Claude reports a Compaction's boundary entry, so only its sessions match.
 */
function compactedAfter(db: Database, sessionId: string, uuid: string) {
  const later = db
    .select({id: compactions.id})
    .from(sessionEntries)
    .innerJoin(
      compactions,
      and(
        eq(compactions.provider, sessionEntries.provider),
        eq(compactions.sessionId, sessionEntries.sessionId)
      )
    )
    .innerJoin(
      boundaries,
      and(
        eq(boundaries.provider, sessionEntries.provider),
        eq(boundaries.projectKey, sessionEntries.projectKey),
        eq(boundaries.sessionId, sessionEntries.sessionId),
        eq(boundaries.subpath, sessionEntries.subpath),
        eq(boundaries.uuid, compactions.boundaryId),
        gt(boundaries.position, sessionEntries.position)
      )
    )
    .where(
      and(
        eq(sessionEntries.sessionId, sessionId),
        eq(sessionEntries.subpath, ''),
        eq(sessionEntries.uuid, uuid)
      )
    )
    .get()

  return later !== undefined
}

/** The last entry a fork, a rewind or a cut keeps of its session. */
export function targetOf(session: Exclude<ReplySession, {type: 'continue'}>) {
  return session.type === 'cut'
    ? (session.keepThrough ?? session.messageId)
    : session.messageId
}

/**
 * Claude no longer finds an entry from before a Compaction in the whole
 * session, so a send whose `target` is one forks from the part through it. The
 * fork stands in for a rewind or a cut too (ADR 0004).
 */
export function reaching<Session extends ReplySession>(
  db: Database,
  session: Session,
  target: string | null
): Session | Extract<ReplySession, {type: 'fork'}> {
  if (target === null || !compactedAfter(db, session.sessionId, target)) {
    return session
  }

  return {
    type: 'fork',
    sessionId: session.sessionId,
    messageId: target,
    servedThrough: target,
  }
}
