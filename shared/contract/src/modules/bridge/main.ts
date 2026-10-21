import type {Command, CommandOutcome} from '#modules/commands/main'
import type {AppEvent} from '#modules/events/main'

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

export const DroppedFileErrorSchema = z.strictObject({
  code: z.enum(['no-path', 'untrusted-sender']),
  message: z.string(),
})

export type DroppedFileError = z.infer<typeof DroppedFileErrorSchema>

export const DroppedFileOutcome = z.union([
  z.strictObject({ok: z.literal(true), id: z.uuid()}),
  z.strictObject({ok: z.literal(false), error: DroppedFileErrorSchema}),
])

export type DroppedFileOutcome = z.infer<typeof DroppedFileOutcome>

/**
 * `window.uz`. These three members are the whole surface, and it never grows
 * per feature.
 */
export interface Bridge {
  send<C extends Command>(command: C): Promise<CommandOutcome<C['type']>>
  subscribe(listener: (event: AppEvent) => void): () => void
  registerDroppedFile(file: File): Promise<DroppedFileOutcome>
}
