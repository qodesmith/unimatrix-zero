import type {WhenIdle} from '#modules/idle/main'
import type {SessionRef} from '@uz/contract/host'

export const IDLE_CLOSE_MS = 10 * 60 * 1000

export const MAX_WARM = 6

export interface WarmSession {
  readonly sessionId: string | null
  readonly messageId: string | null
  close(): Promise<void>
}

interface WarmOptions {
  whenIdle: WhenIdle
  max: number
}

/**
 * Idle sessions close when `whenIdle` says, longest idle first past `max`. One
 * writing a Reply never closes, so more than `max` can be open.
 */
export function createWarmSessions<Session extends WarmSession>({
  whenIdle,
  max,
}: WarmOptions) {
  const open = new Set<Session>()
  /** The idle ones, longest idle first, each with what calls off its close. */
  const idle = new Map<Session, () => void>()
  /** Each session's `claude` still closing. */
  const closing = new Map<string, Set<Promise<void>>>()

  function forget(session: Session) {
    idle.get(session)?.()
    idle.delete(session)
    open.delete(session)
  }

  function close(session: Session) {
    forget(session)
    const closed = session.close().catch(() => undefined)
    const {sessionId} = session

    if (sessionId !== null) void track(sessionId, closed)
  }

  async function track(sessionId: string, closed: Promise<void>) {
    const all = closing.get(sessionId) ?? new Set()

    all.add(closed)
    closing.set(sessionId, all)
    await closed
    all.delete(closed)

    if (all.size === 0 && closing.get(sessionId) === all) {
      closing.delete(sessionId)
    }
  }

  function trim() {
    for (const session of idle.keys()) {
      if (open.size <= max) return

      close(session)
    }
  }

  return {
    /**
     * Closes it at any other point; `closed` says when that `claude` has
     * ended, so the session is never run twice at once.
     */
    claim(ref: SessionRef): Session | null {
      for (const session of idle.keys()) {
        if (session.sessionId !== ref.sessionId) continue

        if (session.messageId === ref.messageId) {
          idle.get(session)?.()
          idle.delete(session)

          return session
        }

        close(session)
      }

      return null
    },

    add(session: Session) {
      open.add(session)
      trim()
    },

    release(session: Session) {
      if (!open.has(session)) return

      idle.set(
        session,
        whenIdle(() => close(session))
      )
      trim()
    },

    drop(session: Session) {
      close(session)
    },

    /** Resolves once every `claude` closing in the session has ended. */
    async closed(sessionId: string) {
      await Promise.all(closing.get(sessionId) ?? new Set<Promise<void>>())
    },

    get size() {
      return open.size
    },
  }
}
