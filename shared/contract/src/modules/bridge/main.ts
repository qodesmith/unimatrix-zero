import type {Command, CommandReply} from '../commands/main'
import type {AppEvent} from '../events/main'

export const BRIDGE_CHANNELS = {
  command: 'uz:command',
  subscribe: 'uz:subscribe',
  event: 'uz:event',
  droppedFile: 'uz:dropped-file',
} as const

export type DroppedFileId = string

export type DroppedFileReply =
  | {ok: true; id: DroppedFileId}
  | {ok: false; error: {code: 'no-path'; message: string}}

/**
 * `window.uz`. These three members are the whole surface, and it never grows
 * per feature.
 */
export type Bridge = {
  send<C extends Command>(command: C): Promise<CommandReply<C['type']>>
  subscribe(listener: (event: AppEvent) => void): () => void
  registerDroppedFile(file: File): Promise<DroppedFileReply>
}
