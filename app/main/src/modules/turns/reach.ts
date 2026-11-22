import type {Database} from '#modules/database/main'
import type {ReplySession} from '@uz/contract/host'

import {schema} from '#modules/database/main'
import {positionOf} from '#modules/sessions/main'
import {eq} from 'drizzle-orm'

const {compactions} = schema

/** Only Claude reports a boundary entry, so only its sessions match. */
function compactedAfter(db: Database, sessionId: string, uuid: string) {
  const at = positionOf(db, sessionId, uuid)

  if (at === null) return false

  return db
    .select({boundaryId: compactions.boundaryId})
    .from(compactions)
    .where(eq(compactions.sessionId, sessionId))
    .all()
    .some(({boundaryId}) => {
      const boundary =
        boundaryId === null ? null : positionOf(db, sessionId, boundaryId)

      return boundary !== null && boundary > at
    })
}

/** The last entry a fork, a rewind or a cut keeps of its session. */
export function targetOf(session: Exclude<ReplySession, {type: 'continue'}>) {
  return session.type === 'cut'
    ? (session.keepThrough ?? session.messageId)
    : session.messageId
}

/**
 * Claude can't find an entry from before a Compaction in the whole session, so
 * a send whose `target` is one forks through it, even for a rewind or a cut.
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
