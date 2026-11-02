import {LayoutSchema} from '#modules/layout/main'
import {
  ModelChoiceSchema,
  ModelSchema,
  ProviderEventSchema,
  ProviderIdSchema,
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
  /** Each Provider's Models as it last listed them; empty if it never has. */
  models: z.record(ProviderIdSchema, z.array(ModelSchema)),
  /** The newest Reply's Model in any Tree, where a new Tree starts. */
  lastModel: ModelChoiceSchema.nullable(),
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

/** A Prompt was sent; a new Tree now starts from its Model. */
export const LastModelChangedEvent = z.strictObject({
  type: z.literal('LAST_MODEL_CHANGED'),
  model: ModelChoiceSchema,
})

export const TreeCreatedEvent = z.strictObject({
  type: z.literal('TREE_CREATED'),
  tree: TreeSchema,
})

/** Anything on its row changed: its title, activity or failure. */
export const TreeChangedEvent = z.strictObject({
  type: z.literal('TREE_CHANGED'),
  tree: TreeSchema,
})

export const TreeDeletedEvent = z.strictObject({
  type: z.literal('TREE_DELETED'),
  treeId: z.uuid(),
})

export const EventSchema = z.discriminatedUnion('type', [
  SnapshotEvent,
  TreeCreatedEvent,
  TreeChangedEvent,
  TreeDeletedEvent,
  SettingsChangedEvent,
  LayoutChangedEvent,
  LastModelChangedEvent,
  ReplyEventSchema,
  ProviderEventSchema,
])

export type AppEvent = z.infer<typeof EventSchema>
