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
    /** Why it failed, as `RunFailureSchema`; null unless it did. */
    failure: text('failure', {mode: 'json'}),
    systemPromptId: text('system_prompt_id')
      .notNull()
      .references(() => systemPrompts.id),
    sessionId: text('session_id'),
    sessionMessageId: text('session_message_id'),
    /**
     * Its Prompt in the Provider session, kept even when the Reply never
     * finished.
     */
    sessionPromptId: text('session_prompt_id'),
    /**
     * Where its Provider session still holds Turns the Tree deleted from below
     * it: their first Prompt there. The next Prompt from it cuts the session
     * there, unless its Provider cut first.
     */
    sessionDropFrom: text('session_drop_from'),
    contextSize: integer('context_size'),
    contextWindow: integer('context_window'),
    createdAt: createdAt(),
  },
  table => [uniqueIndex('replies_prompt_id').on(table.promptId)]
)

function sessionKey() {
  return {
    provider: text('provider', {enum: ['claude', 'chatgpt']}).notNull(),
    projectKey: text('project_key').notNull(),
    sessionId: text('session_id').notNull(),
  }
}

/**
 * Every entry as the vendor program wrote it, in order, never parsed or edited
 * (ADR 0004).
 */
export const sessionEntries = sqliteTable(
  'session_entries',
  {
    id: id(),
    ...sessionKey(),
    /** A Subagent's transcript inside the session; '' for the session's own. */
    subpath: text('subpath').notNull(),
    /** Its place in the transcript, from 0. */
    position: integer('position').notNull(),
    /** The vendor's own entry id, which appends are deduplicated on. */
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

/** One row per Layout key, kept apart from Settings (ADR 0021). */
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
