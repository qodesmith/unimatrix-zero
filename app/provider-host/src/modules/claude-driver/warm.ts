import type {WhenIdle} from '#modules/idle/main'
import type {ReplyRequest, SessionRef} from '@uz/contract/host'
import type {PermissionMode} from '@uz/contract/permissions'
import type {CompactionSettings} from '@uz/contract/settings'
import type {TreeTools} from '@uz/contract/tools'

import {TreeToolsSchema} from '@uz/contract/tools'

export const IDLE_CLOSE_MS = 10 * 60 * 1000

export const MAX_WARM = 6

/**
 * Whether `claude` reads each switch. A flip of one it doesn't read keeps a
 * warm session.
 */
const CLAUDE_READS: Record<keyof TreeTools, boolean> = {
  webSearch: true,
  claudeConnectors: true,
  claudeBuiltInSkills: true,
  chatgptBuiltInSkills: false,
  chatgptRemotePlugins: false,
}

const CLAUDE_TOOLS = TreeToolsSchema.keyof().options.filter(
  key => CLAUDE_READS[key]
)

export interface WarmSession {
  readonly sessionId: string | null
  readonly messageId: string | null
  readonly model: string
  /** Fixed as `claude` starts: it applies no later change to the threshold. */
  readonly compactionSettings: CompactionSettings
  /** Fixed as `claude` starts: a changed System prompt needs a new `claude`. */
  readonly systemPrompt: string
  /** Fixed as `claude` starts: it can't add or remove a tool later. */
  readonly tools: TreeTools
  /** Fixed as `claude` starts, with the callback that asks. */
  readonly permissionMode: PermissionMode
  close(): Promise<void>
}

interface WarmOptions {
  whenIdle: WhenIdle
  max: number
  resolveModel: (id: string) => string
}

/**
 * Idle sessions close when `whenIdle` says, longest idle first past `max`. One
 * writing a Reply never closes, so more than `max` can be open.
 */
export function createWarmSessions<Session extends WarmSession>({
  whenIdle,
  max,
  resolveModel,
}: WarmOptions) {
  const open = new Set<Session>()
  const idle = new Map<Session, () => void>()
  const closing = new Map<string, Set<Promise<void>>>()

  function wake(session: Session) {
    idle.get(session)?.()
    idle.delete(session)
  }

  function forget(session: Session) {
    wake(session)
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
     * Closes it at any other point, on another Model, with other Compaction
     * Settings, under another System prompt, with other tools or under another
     * Permission mode, so `claude` never runs a session twice. Another name for
     * its Model keeps it.
     */
    claim(
      ref: SessionRef,
      {
        model,
        compactionSettings,
        systemPrompt,
        tools,
        permissionMode,
      }: Pick<
        ReplyRequest,
        | 'model'
        | 'compactionSettings'
        | 'systemPrompt'
        | 'tools'
        | 'permissionMode'
      >
    ): Session | null {
      const wanted = resolveModel(model)

      for (const session of idle.keys()) {
        if (session.sessionId !== ref.sessionId) continue

        if (
          session.messageId === ref.messageId &&
          resolveModel(session.model) === wanted &&
          session.compactionSettings.auto === compactionSettings.auto &&
          session.compactionSettings.threshold ===
            compactionSettings.threshold &&
          session.systemPrompt === systemPrompt &&
          CLAUDE_TOOLS.every(key => session.tools[key] === tools[key]) &&
          session.permissionMode === permissionMode
        ) {
          wake(session)

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

      wake(session)
      idle.set(
        session,
        whenIdle(() => close(session))
      )
      trim()
    },

    drop(session: Session) {
      close(session)
    },

    async closed(sessionId: string) {
      await Promise.all(closing.get(sessionId) ?? new Set<Promise<void>>())
    },

    get size() {
      return open.size
    },
  }
}
