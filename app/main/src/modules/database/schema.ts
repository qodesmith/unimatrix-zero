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

export const trees = sqliteTable('trees', {
  id: id(),
  title: text('title'),
  unseenFailure: integer('unseen_failure', {mode: 'boolean'})
    .notNull()
    .default(false),
  createdAt: createdAt(),
})

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

/** One row per add, so a file added twice gets two. */
export const attachments = sqliteTable('attachments', {
  id: id(),
  /**
   * Names the folder under `userData/attachments/` that adds of the same bytes
   * share; null for a folder, which the app never copies.
   */
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
  /**
   * The smaller copy sent in a large image's place; all three null when the
   * original goes as is.
   */
  shrunkSha256: text('shrunk_sha256'),
  shrunkMediaType: text('shrunk_media_type', {
    enum: ['image/png', 'image/jpeg'],
  }),
  shrunkSize: integer('shrunk_size'),
  folderPath: text('folder_path'),
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
    /** From 0. */
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
    /** As `RunFailureSchema`; null unless the Reply failed. */
    failure: text('failure', {mode: 'json'}),
    systemPromptId: text('system_prompt_id')
      .notNull()
      .references(() => systemPrompts.id),
    sessionId: text('session_id'),
    sessionMessageId: text('session_message_id'),
    /** Its Prompt in the Provider session, kept if the Reply never finished. */
    sessionPromptId: text('session_prompt_id'),
    /**
     * The first session Prompt of Turns deleted below it that the session still
     * holds; the next Prompt from it cuts there, unless its Provider cut first.
     */
    sessionDropFrom: text('session_drop_from'),
    contextSize: integer('context_size'),
    contextWindow: integer('context_window'),
    rebuilt: integer('rebuilt', {mode: 'boolean'}).notNull().default(false),
    /**
     * Its Snapshot in the Tree's hidden store; its parent's when it changed no
     * file. Null while the Tree has no files, and until it finishes.
     */
    snapshotCommit: text('snapshot_commit'),
    /** Null too when the app quit before taking the Snapshot. */
    noSnapshot: text('no_snapshot', {enum: ['no-files', 'failed']}),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('replies_prompt_id').on(table.promptId)]
)

/**
 * Keyed to the Provider session, which keeps the Compaction after its Reply is
 * deleted or retried.
 */
export const compactions = sqliteTable('compactions', {
  id: id(),
  provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
  sessionId: text('session_id').notNull(),
  /** Claude's boundary entry in the session; Codex reports none. */
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

/**
 * Every entry as the vendor program wrote it, never parsed or edited
 * (ADR 0004).
 */
export const sessionEntries = sqliteTable(
  'session_entries',
  {
    id: id(),
    ...sessionKey(),
    /** A Subagent's transcript; '' for the session's own. */
    subpath: text('subpath').notNull(),
    /** From 0. */
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
    /** Relative to the session's folder, with `/` between parts. */
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
    /** As `ModelSchema`. */
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
