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
import {SystemPromptLibrarySchema} from '#modules/system-prompts/main'
import {TreeSchema} from '#modules/trees/main'
import {
  ApprovalRequestedEvent,
  FilesChangedEvent,
  ReplyEventSchema,
  StreamingReplySchema,
} from '#modules/turns/main'
import {z} from 'zod'

export const SnapshotEvent = z.strictObject({
  type: z.literal('SNAPSHOT'),
  app: z.strictObject({version: z.string()}),
  replies: z.array(StreamingReplySchema),
  approvals: z.array(ApprovalRequestedEvent),
  providers: z.array(ProviderStatusSchema),
  models: z.record(ProviderIdSchema, z.array(ModelSchema)),
  lastModel: ModelChoiceSchema.nullable(),
  signIn: SignInStepEvent.nullable(),
  settings: SettingsSchema,
  systemPrompts: SystemPromptLibrarySchema,
  layout: LayoutSchema,
})

export const SettingsChangedEvent = z.strictObject({
  type: z.literal('SETTINGS_CHANGED'),
  settings: SettingsSchema,
})

export const SystemPromptsChangedEvent = z.strictObject({
  type: z.literal('SYSTEM_PROMPTS_CHANGED'),
  systemPrompts: SystemPromptLibrarySchema,
})

export const LayoutChangedEvent = z.strictObject({
  type: z.literal('LAYOUT_CHANGED'),
  layout: LayoutSchema,
})

export const LastModelChangedEvent = z.strictObject({
  type: z.literal('LAST_MODEL_CHANGED'),
  model: ModelChoiceSchema,
})

export const TreeCreatedEvent = z.strictObject({
  type: z.literal('TREE_CREATED'),
  tree: TreeSchema,
})

export const TreeChangedEvent = z.strictObject({
  type: z.literal('TREE_CHANGED'),
  tree: TreeSchema,
})

export const TreeDeletedEvent = z.strictObject({
  type: z.literal('TREE_DELETED'),
  treeId: z.uuid(),
})

export const SnapshotsWaitingEvent = z.strictObject({
  type: z.literal('SNAPSHOTS_WAITING'),
})

/**
 * The app's own `git` failed to download while a Snapshot waited on it, or on
 * the user's Try again (`snapshots.download-again`).
 */
export const SnapshotsDownloadFailedEvent = z.strictObject({
  type: z.literal('SNAPSHOTS_DOWNLOAD_FAILED'),
})

export const SnapshotsDownloadedEvent = z.strictObject({
  type: z.literal('SNAPSHOTS_DOWNLOADED'),
})

/**
 * This Linux is too old for the app's own `git`, so no Snapshot is ever
 * taken. Sent once per launch, at the first wait a window can hear.
 */
export const SnapshotsNeedNewerLinuxEvent = z.strictObject({
  type: z.literal('SNAPSHOTS_NEED_NEWER_LINUX'),
})

export const EventSchema = z.discriminatedUnion('type', [
  SnapshotEvent,
  TreeCreatedEvent,
  TreeChangedEvent,
  TreeDeletedEvent,
  SettingsChangedEvent,
  SystemPromptsChangedEvent,
  LayoutChangedEvent,
  LastModelChangedEvent,
  ReplyEventSchema,
  FilesChangedEvent,
  SnapshotsWaitingEvent,
  SnapshotsDownloadFailedEvent,
  SnapshotsDownloadedEvent,
  SnapshotsNeedNewerLinuxEvent,
  ProviderEventSchema,
])

export type AppEvent = z.infer<typeof EventSchema>
