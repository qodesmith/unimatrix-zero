import {TreeSchema} from '#modules/trees/main'
import {z} from 'zod'

export const SnapshotEvent = z.strictObject({
  type: z.literal('SNAPSHOT'),
  app: z.strictObject({version: z.string()}),
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
])

export type AppEvent = z.infer<typeof EventSchema>
