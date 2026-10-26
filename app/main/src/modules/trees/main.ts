import type {Database} from '#modules/database/main'
import type {Tree} from '@uz/contract/trees'

import {schema} from '#modules/database/main'
import {desc, eq} from 'drizzle-orm'

type TreeRow = typeof schema.trees.$inferSelect

function toTree(row: TreeRow): Tree {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  }
}

export type Trees = ReturnType<typeof createTrees>

export function createTrees(db: Database) {
  const {trees} = schema

  return {
    create(now: Date): Tree {
      return toTree(db.insert(trees).values({createdAt: now}).returning().get())
    },

    list(): Tree[] {
      return db
        .select()
        .from(trees)
        .orderBy(desc(trees.createdAt), desc(trees.id))
        .all()
        .map(toTree)
    },

    get(id: string): Tree | null {
      const row = db.select().from(trees).where(eq(trees.id, id)).get()

      return row ? toTree(row) : null
    },

    rename(id: string, title: string): Tree | null {
      const row = db
        .update(trees)
        .set({title})
        .where(eq(trees.id, id))
        .returning()
        .get()

      return row ? toTree(row) : null
    },
  }
}
