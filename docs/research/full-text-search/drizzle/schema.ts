import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const trees = sqliteTable('trees', { id: text().primaryKey(), title: text() });
export const prompts = sqliteTable('prompts', {
  id: text().primaryKey(),
  treeId: text('tree_id').notNull().references(() => trees.id, { onDelete: 'cascade' }),
  body: text().notNull(),
});
export const searchDocs = sqliteTable('search_docs', {
  rowid: integer().primaryKey(),
  turnId: text('turn_id').notNull().unique().references(() => prompts.id, { onDelete: 'cascade' }),
  treeId: text('tree_id').notNull(),
  body: text().notNull().default(''),
});
