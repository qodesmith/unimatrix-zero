import type {Command, CommandOutcome} from '../commands/main'
import type {AppEvent} from '../events/main'

import {z} from 'zod'

export const BRIDGE_CHANNELS = {
  command: 'uz:command',
  subscribe: 'uz:subscribe',
  event: 'uz:event',
  droppedFile: 'uz:dropped-file',
} as const

/** What the preload hands main for a dropped file. The page never sees the path. */
export const DroppedFileRegistration = z.strictObject({
  path: z.string(),
})

export const DroppedFileOutcome = z.union([
  z.strictObject({ok: z.literal(true), id: z.uuid()}),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(['no-path', 'untrusted-sender']),
      message: z.string(),
    }),
  }),
])

export type DroppedFileOutcome = z.infer<typeof DroppedFileOutcome>

/**
 * `window.uz`. These three members are the whole surface, and it never grows
 * per feature.
 */
export type Bridge = {
  send<C extends Command>(command: C): Promise<CommandOutcome<C['type']>>
  subscribe(listener: (event: AppEvent) => void): () => void
  registerDroppedFile(file: File): Promise<DroppedFileOutcome>
}
