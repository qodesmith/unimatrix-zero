import type {Database} from '#modules/database/main'
import type {Thread} from '@uz/contract/host'
import type {Model, ModelChoice, ProviderId} from '@uz/contract/providers'

import {originalsOf} from '#modules/attachments/main'
import {schema} from '#modules/database/main'
import {replyLabel} from '@uz/contract/host'
import {concreteId, modelName} from '@uz/contract/providers'
import {ReplyPartSchema} from '@uz/contract/turns'
import {and, eq} from 'drizzle-orm'
import {z} from 'zod'

const {prompts, replies} = schema

const ContentSchema = z.array(ReplyPartSchema)

export type ListedModels = (provider: ProviderId) => Model[]

interface ThreadSources {
  listed: ListedModels
  attachmentsDir: string
}

function labelFor({provider, model}: ModelChoice, listed: ListedModels) {
  return replyLabel(modelName(listed(provider), model))
}

/**
 * The Thread that ends at the Reply, whole, as a Prompt sent on `to` continues
 * it: each Reply another Model wrote is labeled with that Model's name. Each
 * Prompt carries its original attachments, which the host converts afresh.
 */
export function threadTo(
  db: Database,
  treeId: string,
  replyId: string | null,
  to: ModelChoice,
  {listed, attachmentsDir}: ThreadSources
): Thread {
  const thread: Thread = []
  const continuing = concreteId(listed(to.provider), to.model)
  let next = replyId

  while (next !== null) {
    const row = db
      .select({
        provider: replies.provider,
        model: replies.model,
        content: replies.content,
        promptId: prompts.id,
        prompt: prompts.text,
        parentReplyId: prompts.parentReplyId,
      })
      .from(replies)
      .innerJoin(prompts, eq(prompts.id, replies.promptId))
      .where(and(eq(replies.id, next), eq(replies.treeId, treeId)))
      .get()

    if (!row) break

    const {provider, model} = row

    const own =
      provider === to.provider &&
      concreteId(listed(provider), model) === continuing

    thread.unshift({
      prompt: row.prompt,
      attachments: originalsOf(db, attachmentsDir, row.promptId),
      reply: ContentSchema.parse(row.content),
      label: own ? null : labelFor({provider, model}, listed),
    })
    next = row.parentReplyId
  }

  return thread
}
