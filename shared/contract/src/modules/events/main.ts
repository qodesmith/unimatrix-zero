import {ProviderEventSchema} from '#modules/providers/main'
import {TreeSchema} from '#modules/trees/main'
import {ReplyEventSchema, StreamingReplySchema} from '#modules/turns/main'
import {z} from 'zod'

export const SnapshotEvent = z.strictObject({
  type: z.literal('SNAPSHOT'),
  app: z.strictObject({version: z.string()}),
  /** Every Reply still being written, as displayed when the window connected. */
  replies: z.array(StreamingReplySchema),
})

export const TreeCreatedEvent = z.strictObject({
  type: z.literal('TREE_CREATED'),
  tree: TreeSchema,
})

export const TreeRenamedEvent = z.strictObject({
  type: z.literal('TREE_RENAMED'),
  tree: TreeSchema,
})

export const EventSchema = z.discriminatedUnion('type', [
  SnapshotEvent,
  TreeCreatedEvent,
  TreeRenamedEvent,
  ReplyEventSchema,
  ProviderEventSchema,
])

export type AppEvent = z.infer<typeof EventSchema>
