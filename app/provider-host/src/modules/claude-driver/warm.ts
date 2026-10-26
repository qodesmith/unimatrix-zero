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

  function forget(session: Session) {
    idle.get(session)?.()
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
    /** Closes it at any other point, so `claude` never runs a session twice. */
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

    get size() {
      return open.size
    },
  }
}
