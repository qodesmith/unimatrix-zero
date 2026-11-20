import type {Database} from '#modules/database/main'
import type {Thread} from '@uz/contract/host'
import type {Model, ModelChoice, ProviderId} from '@uz/contract/providers'

import {hostAttachments} from '#modules/attachments/main'
import {schema} from '#modules/database/main'
import {replyLabel} from '@uz/contract/host'
import {concreteId, modelName} from '@uz/contract/providers'
import {ReplyPartSchema} from '@uz/contract/turns'
import {and, eq} from 'drizzle-orm'
import {z} from 'zod'

const {prompts, replies} = schema

const ContentSchema = z.array(ReplyPartSchema)

export type ListedModels = (provider: ProviderId) => Model[]

/** A Thread before its attachments are planned, with each Exchange's Prompt. */
export interface WalkedThread {
  thread: Thread
  promptIds: string[]
}

function labelFor({provider, model}: ModelChoice, listed: ListedModels) {
  return replyLabel(modelName(listed(provider), model))
}

/**
 * The Thread that ends at the Reply, whole, as a Prompt sent on `to` continues
 * it: each Reply another Model wrote is labeled with that Model's name. Its
 * attachments come from `withAttachments`, once the Prompt being sent is saved.
 */
export function threadTo(
  db: Database,
  treeId: string,
  replyId: string | null,
  to: ModelChoice,
  listed: ListedModels
): WalkedThread {
  const thread: Thread = []
  const promptIds: string[] = []
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
      attachments: [],
      reply: ContentSchema.parse(row.content),
      label: own ? null : labelFor({provider, model}, listed),
    })
    promptIds.unshift(row.promptId)
    next = row.parentReplyId
  }

  return {thread, promptIds}
}

interface Sending {
  provider: ProviderId
  /** The Prompt being sent, which the Thread leads up to. */
  promptId: string
  attachmentsDir: string
}

/**
 * One plan over the whole Thread and the Prompt being sent, for the Provider
 * they go to: a hand-over gets the new Provider's rules, and Claude's media
 * budget counts every earlier Prompt.
 */
export function withAttachments(
  db: Database,
  {thread, promptIds}: WalkedThread,
  {provider, promptId, attachmentsDir}: Sending
) {
  const planned = hostAttachments(db, attachmentsDir, provider, [
    ...promptIds,
    promptId,
  ])

  return {
    thread: thread.map((turn, at) => ({
      ...turn,
      attachments: planned[at] ?? [],
    })),
    attachments: planned.at(-1) ?? [],
  }
}
