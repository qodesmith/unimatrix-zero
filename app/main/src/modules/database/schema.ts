import type {AnySQLiteColumn} from 'drizzle-orm/sqlite-core'

import {
  blob,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {randomUUIDv7} from 'node:crypto'

function id() {
  return text('id')
    .primaryKey()
    .$defaultFn(() => randomUUIDv7())
}

function createdAt() {
  return integer('created_at', {mode: 'timestamp_ms'})
    .notNull()
    .$defaultFn(() => new Date())
}

function toolSwitch(name: string, existing: boolean) {
  return integer(name, {mode: 'boolean'}).notNull().default(existing)
}

/** Append-only: a Tree and each Reply point at the text they run under. */
export const systemPrompts = sqliteTable(
  'system_prompts',
  {
    id: id(),
    hash: text('hash').notNull(),
    text: text('text').notNull(),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('system_prompts_hash').on(table.hash)]
)

export const trees = sqliteTable('trees', {
  id: id(),
  title: text('title'),
  unseenFailure: integer('unseen_failure', {mode: 'boolean'})
    .notNull()
    .default(false),
  systemPromptId: text('system_prompt_id')
    .notNull()
    .references(() => systemPrompts.id),
  // A Tree from before these columns keeps web search and gets the rest off.
  webSearch: toolSwitch('web_search', true),
  claudeConnectors: toolSwitch('claude_connectors', false),
  claudeBuiltInSkills: toolSwitch('claude_built_in_skills', false),
  chatgptBuiltInSkills: toolSwitch('chatgpt_built_in_skills', false),
  chatgptRemotePlugins: toolSwitch('chatgpt_remote_plugins', false),
  approvalGrants: text('approval_grants', {mode: 'json'}).notNull().default([]),
  createdAt: createdAt(),
})

export const systemPromptLibrary = sqliteTable('system_prompt_library', {
  id: id(),
  name: text('name').notNull(),
  text: text('text').notNull(),
  createdAt: createdAt(),
})

export const prompts = sqliteTable('prompts', {
  id: id(),
  treeId: text('tree_id')
    .notNull()
    .references(() => trees.id, {onDelete: 'cascade'}),
  parentReplyId: text('parent_reply_id').references(
    (): AnySQLiteColumn => replies.id,
    {onDelete: 'cascade'}
  ),
  text: text('text').notNull(),
  createdAt: createdAt(),
})

export const attachments = sqliteTable('attachments', {
  id: id(),
  sha256: text('sha256'),
  name: text('name').notNull(),
  mediaType: text('media_type', {
    enum: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/octet-stream',
      'inode/directory',
    ],
  }).notNull(),
  size: integer('size').notNull(),
  shrunkSha256: text('shrunk_sha256'),
  shrunkMediaType: text('shrunk_media_type', {
    enum: ['image/png', 'image/jpeg'],
  }),
  shrunkSize: integer('shrunk_size'),
  folderPath: text('folder_path'),
  extraction: text('extraction', {mode: 'json'}),
  createdAt: createdAt(),
})

export const promptAttachments = sqliteTable(
  'prompt_attachments',
  {
    id: id(),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id, {onDelete: 'cascade'}),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id),
    position: integer('position').notNull(),
  },
  table => [
    uniqueIndex('prompt_attachments_position').on(
      table.promptId,
      table.position
    ),
  ]
)

export const replies = sqliteTable(
  'replies',
  {
    id: id(),
    treeId: text('tree_id')
      .notNull()
      .references(() => trees.id, {onDelete: 'cascade'}),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id, {onDelete: 'cascade'}),
    provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
    model: text('model').notNull(),
    status: text('status', {
      enum: ['streaming', 'complete', 'stopped', 'failed', 'interrupted'],
    }).notNull(),
    content: text('content', {mode: 'json'}).notNull().$type<unknown[]>(),
    failure: text('failure', {mode: 'json'}),
    systemPromptId: text('system_prompt_id')
      .notNull()
      .references(() => systemPrompts.id),
    sessionId: text('session_id'),
    sessionMessageId: text('session_message_id'),
    sessionPromptId: text('session_prompt_id'),
    /**
     * The first Prompt of deleted Turns still in the session; the next send
     * cuts there unless its Provider cut first.
     */
    sessionDropFrom: text('session_drop_from'),
    contextSize: integer('context_size'),
    contextWindow: integer('context_window'),
    rebuilt: integer('rebuilt', {mode: 'boolean'}).notNull().default(false),
    snapshotCommit: text('snapshot_commit'),
    noSnapshot: text('no_snapshot', {enum: ['no-files', 'failed']}),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('replies_prompt_id').on(table.promptId)]
)

/** Keyed to the session, which keeps the Compaction after its Reply goes. */
export const compactions = sqliteTable('compactions', {
  id: id(),
  provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
  sessionId: text('session_id').notNull(),
  boundaryId: text('boundary_id'),
  replyId: text('reply_id').references(() => replies.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
})

function sessionKey() {
  return {
    provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
    projectKey: text('project_key').notNull(),
    sessionId: text('session_id').notNull(),
  }
}

/** Each entry as the vendor program wrote it, never parsed or edited (ADR 0004). */
export const sessionEntries = sqliteTable(
  'session_entries',
  {
    id: id(),
    ...sessionKey(),
    subpath: text('subpath').notNull(),
    position: integer('position').notNull(),
    uuid: text('uuid'),
    entry: blob('entry', {mode: 'buffer'}).notNull(),
  },
  table => [
    uniqueIndex('session_entries_position').on(
      table.provider,
      table.projectKey,
      table.sessionId,
      table.subpath,
      table.position
    ),
    uniqueIndex('session_entries_uuid').on(
      table.provider,
      table.projectKey,
      table.sessionId,
      table.subpath,
      table.uuid
    ),
  ]
)

export const sessionFiles = sqliteTable(
  'session_files',
  {
    id: id(),
    ...sessionKey(),
    path: text('path').notNull(),
    data: blob('data', {mode: 'buffer'}).notNull(),
  },
  table => [
    uniqueIndex('session_files_path').on(
      table.provider,
      table.projectKey,
      table.sessionId,
      table.path
    ),
  ]
)

export const providers = sqliteTable(
  'providers',
  {
    id: id(),
    provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
    email: text('email').notNull(),
    plan: text('plan').notNull(),
    connectedAt: integer('connected_at', {mode: 'timestamp_ms'}).notNull(),
    models: text('models', {mode: 'json'}).notNull().default([]),
  },
  table => [uniqueIndex('providers_provider').on(table.provider)]
)

export const settings = sqliteTable(
  'settings',
  {
    id: id(),
    key: text('key').notNull(),
    value: text('value', {mode: 'json'}).notNull(),
  },
  table => [uniqueIndex('settings_key').on(table.key)]
)

export const layout = sqliteTable(
  'layout',
  {
    id: id(),
    key: text('key').notNull(),
    value: text('value', {mode: 'json'}).notNull(),
  },
  table => [uniqueIndex('layout_key').on(table.key)]
)

export const themes = sqliteTable('themes', {
  id: id(),
  json: text('json').notNull(),
  createdAt: createdAt(),
})
