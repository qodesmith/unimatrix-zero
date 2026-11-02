import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'
import type {ReplyStatus} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {TREE_TITLE_MAX_LENGTH} from '@uz/contract/trees'
import {and, desc, eq, getColumns, isNull, sql} from 'drizzle-orm'

const {trees, prompts} = schema

const rootText = sql<string | null>`(
  select ${prompts.text} from ${prompts}
  where ${prompts.treeId} = ${trees.id} and ${prompts.parentReplyId} is null
  order by ${prompts.createdAt}, ${prompts.id}
  limit 1
)`

const lastActiveAt = sql`coalesce(
  (select max(${prompts.createdAt}) from ${prompts}
    where ${prompts.treeId} = ${trees.id}),
  ${trees.createdAt}
)`

const turnCount = sql<number>`(
  select count(*) from ${prompts} where ${prompts.treeId} = ${trees.id}
)`

const rowFields = {
  ...getColumns(trees),
  rootText,
  lastActiveAt: lastActiveAt.mapWith(trees.createdAt),
  turnCount: turnCount.mapWith(Number),
}

/** A Prompt is trimmed when sent, so its first line has text. */
function firstLineOf(text: string | null) {
  const line = text?.split('\n', 1)[0]?.trim()

  return line === undefined ? null : line.slice(0, TREE_TITLE_MAX_LENGTH)
}

type TreeRow = NonNullable<ReturnType<ReturnType<typeof selectRows>['get']>>

function selectRows(db: Database) {
  return db.select(rowFields).from(trees)
}

function toTree(row: TreeRow): Tree {
  return {
    id: row.id,
    title: row.title,
    firstLine: firstLineOf(row.rootText),
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    turnCount: row.turnCount,
    unseenFailure: row.unseenFailure,
  }
}

export type Trees = ReturnType<typeof createTrees>

export function createTrees(db: Database) {
  function get(id: string): Tree | null {
    const row = selectRows(db).where(eq(trees.id, id)).get()

    return row ? toTree(row) : null
  }

  function updated(row: {id: string} | undefined) {
    return row ? get(row.id) : null
  }

  return {
    create(now: Date): Tree {
      const {id} = db
        .insert(trees)
        .values({createdAt: now})
        .returning({id: trees.id})
        .get()

      const tree = get(id)

      if (!tree) throw new Error('That Tree was not saved.')

      return tree
    },

    /** The Tree last active first. */
    list(): Tree[] {
      return selectRows(db)
        .orderBy(desc(lastActiveAt), desc(trees.id))
        .all()
        .map(toTree)
    },

    get,

    rename(id: string, title: string): Tree | null {
      return updated(
        db
          .update(trees)
          .set({title})
          .where(eq(trees.id, id))
          .returning({id: trees.id})
          .get()
      )
    },

    /** The automatic title, unless the Tree already has one; null if not. */
    nameAutomatically(id: string, title: string): Tree | null {
      return updated(
        db
          .update(trees)
          .set({title})
          .where(and(eq(trees.id, id), isNull(trees.title)))
          .returning({id: trees.id})
          .get()
      )
    },

    /** The Tree after its failures were seen, and whether it had any unseen. */
    markSeen(id: string): {tree: Tree; changed: boolean} | null {
      const changed = db
        .update(trees)
        .set({unseenFailure: false})
        .where(and(eq(trees.id, id), eq(trees.unseenFailure, true)))
        .returning({id: trees.id})
        .get()

      const tree = get(id)

      return tree && {tree, changed: changed !== undefined}
    },

    markFailed(id: string): Tree | null {
      return updated(
        db
          .update(trees)
          .set({unseenFailure: true})
          .where(eq(trees.id, id))
          .returning({id: trees.id})
          .get()
      )
    },

    /** Its Turns go with it; whether it existed. */
    delete(id: string): boolean {
      return (
        db.delete(trees).where(eq(trees.id, id)).returning().get() !== undefined
      )
    },
  }
}

/** Tells every window a Tree's row changed as its Turns did. */
export function createTreeRows(
  store: Trees,
  publish: (event: AppEvent) => void
) {
  function changed(tree: Tree | null) {
    if (tree) publish({type: 'TREE_CHANGED', tree})
  }

  return {
    /** A Prompt in it was sent or deleted. */
    turnsChanged: (treeId: string) => changed(store.get(treeId)),

    replyFinished({treeId, status}: {treeId: string; status: ReplyStatus}) {
      if (status === 'failed') changed(store.markFailed(treeId))
    },
  }
}
