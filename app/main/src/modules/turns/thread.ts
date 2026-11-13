import type {Database} from '#modules/database/main'
import type {Thread} from '@uz/contract/host'
import type {Model, ModelChoice, ProviderId} from '@uz/contract/providers'

import {schema} from '#modules/database/main'
import {findModel} from '@uz/contract/providers'
import {ReplyPartSchema} from '@uz/contract/turns'
import {and, eq} from 'drizzle-orm'
import {z} from 'zod'

const {prompts, replies} = schema

const ContentSchema = z.array(ReplyPartSchema)

/** Goes in the System prompt of every Reply whose Thread has a label. */
const LABELS_LINE =
  'Some Replies in this conversation begin with a label such as "[Reply written by GPT-5]". The app adds it to each Reply that another AI model wrote: those words are that model’s, not yours, so judge them as you would anyone else’s and disagree where they are wrong. Never write such a label yourself, and don’t mention the labels.'

/** Each Provider's Models as it last listed them. */
export type ListedModels = (provider: ProviderId) => Model[]

/** The Model an alias or the Provider's default stands for, as listed now. */
function concrete(listed: Model[], id: string) {
  return listed.find(model => model.id === id)?.resolvesTo ?? id
}

function labelFor({provider, model}: ModelChoice, listed: ListedModels) {
  const name = findModel(listed(provider), model)?.name ?? model

  return `[Reply written by ${name}]`
}

/**
 * The Thread that ends at the Reply, whole, as a Prompt sent on `to` continues
 * it: each Reply another Model wrote is labeled with that Model's name.
 */
export function threadTo(
  db: Database,
  treeId: string,
  replyId: string | null,
  to: ModelChoice,
  listed: ListedModels
): Thread {
  const thread: Thread = []
  const continuing = concrete(listed(to.provider), to.model)
  let next = replyId

  while (next !== null) {
    const row = db
      .select({
        provider: replies.provider,
        model: replies.model,
        content: replies.content,
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
      concrete(listed(provider), model) === continuing

    thread.unshift({
      prompt: row.prompt,
      reply: ContentSchema.parse(row.content),
      label: own ? null : labelFor({provider, model}, listed),
    })
    next = row.parentReplyId
  }

  return thread
}

/**
 * The System prompt as the Provider gets it. The Reply records only the
 * user's own, which the line is no part of.
 */
export function explainingLabels(systemPrompt: string, thread: Thread) {
  if (thread.every(exchange => exchange.label === null)) return systemPrompt

  return systemPrompt === '' ? LABELS_LINE : `${systemPrompt}\n\n${LABELS_LINE}`
}
