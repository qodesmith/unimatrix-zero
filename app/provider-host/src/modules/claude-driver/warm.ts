import type {SessionRef} from '@uz/contract/host'

/** A warm session closes after this long without a Prompt. */
export const IDLE_CLOSE_MS = 10 * 60 * 1000

/** At most this many stay open once their Replies are written. */
export const MAX_WARM = 6

export interface WarmSession {
  readonly sessionId: string | null
  readonly messageId: string | null
  close(): Promise<void>
}

interface WarmOptions {
  idleMs: number
  max: number
}

/**
 * The open sessions, so the next Prompt in a Thread goes to the `claude`
 * that wrote its last Reply. One between Prompts is idle: it closes after
 * `idleMs`, and the longest idle closes first whenever more than `max` are
 * open. One writing a Reply never closes, so more than `max` can be open
 * while every one of them is.
 */
export function createWarmSessions<Session extends WarmSession>({
  idleMs,
  max,
}: WarmOptions) {
  const open = new Set<Session>()
  /** The idle ones, longest idle first, each with its close timer. */
  const idle = new Map<Session, ReturnType<typeof setTimeout>>()

  function forget(session: Session) {
    clearTimeout(idle.get(session))
    idle.delete(session)
    open.delete(session)
  }

  function close(session: Session) {
    forget(session)
    void session.close().catch(() => undefined)
  }

  function trim() {
    for (const session of idle.keys()) {
      if (open.size <= max) return

      close(session)
    }
  }

  return {
    /**
     * The idle session standing at that point of that Provider session, now
     * writing a Reply. Null when there is none; one of the same session at
     * another point is closed, so `claude` never runs it twice.
     */
    claim(ref: SessionRef): Session | null {
      for (const session of idle.keys()) {
        if (session.sessionId !== ref.sessionId) continue

        if (session.messageId === ref.messageId) {
          clearTimeout(idle.get(session))
          idle.delete(session)

          return session
        }

        close(session)
      }

      return null
    },

    /** A session just opened to write a Reply. */
    add(session: Session) {
      open.add(session)
      trim()
    },

    /** The session finished its Reply and waits for the next Prompt. */
    release(session: Session) {
      if (!open.has(session)) return

      idle.set(
        session,
        setTimeout(() => close(session), idleMs)
      )
      trim()
    },

    /** The session ended, or can't be used again; it is closed. */
    drop(session: Session) {
      close(session)
    },

    /** How many are open, idle or writing. */
    get size() {
      return open.size
    },
  }
}
