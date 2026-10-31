import {LayoutSchema} from '#modules/layout/main'
import {
  ProviderEventSchema,
  ProviderStatusSchema,
  SignInStepEvent,
} from '#modules/providers/main'
import {SettingsSchema} from '#modules/settings/main'
import {TreeSchema} from '#modules/trees/main'
import {ReplyEventSchema, StreamingReplySchema} from '#modules/turns/main'
import {z} from 'zod'

export const SnapshotEvent = z.strictObject({
  type: z.literal('SNAPSHOT'),
  app: z.strictObject({version: z.string()}),
  /** Every Reply still being written, as displayed when the window connected. */
  replies: z.array(StreamingReplySchema),
  /** Every Provider, connected or not. */
  providers: z.array(ProviderStatusSchema),
  /** The Provider being connected, at its latest step. */
  signIn: SignInStepEvent.nullable(),
  settings: SettingsSchema,
  layout: LayoutSchema,
})

export const SettingsChangedEvent = z.strictObject({
  type: z.literal('SETTINGS_CHANGED'),
  settings: SettingsSchema,
})

export const LayoutChangedEvent = z.strictObject({
  type: z.literal('LAYOUT_CHANGED'),
  layout: LayoutSchema,
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
  SettingsChangedEvent,
  LayoutChangedEvent,
  ReplyEventSchema,
  ProviderEventSchema,
])

export type AppEvent = z.infer<typeof EventSchema>
