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

/** The last entry the send keeps of its session. */
function targetOf(session: ReplySession) {
  return session.type === 'cut'
    ? (session.keepThrough ?? session.messageId)
    : session.messageId
}

/**
 * Claude no longer finds an entry from before a Compaction in the whole
 * session, so a send that targets one forks from the session served only
 * through it. The fork holds nothing after the target: it stands in for a
 * rewind or a cut too, and the session it leaves is never added to after
 * being served in part.
 */
export function reaching<Session extends ReplySession>(
  db: Database,
  session: Session
): Session | Extract<ReplySession, {type: 'fork'}> {
  const target = targetOf(session)

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
