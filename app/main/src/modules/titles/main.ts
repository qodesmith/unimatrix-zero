import type {ProviderHosts} from '#modules/provider-hosts/main'
import type {Trees} from '#modules/trees/main'
import type {FinishedReply, Turns} from '#modules/turns/main'
import type {AppEvent} from '@uz/contract/events'
import type {SignInRequest} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {TREE_TITLE_MAX_LENGTH} from '@uz/contract/trees'

const EXCERPT_LENGTH = 2000

/** A stopped Reply has finished too: its text so far is what it says. */
const FINISHED: ReadonlySet<FinishedReply['status']> = new Set([
  'complete',
  'stopped',
])

const EDGE_MARKS = /^[\s#>*_`"'“”‘’]+|[\s*_`"'“”‘’.]+$/g

interface TitlesDeps {
  trees: Pick<Trees, 'get' | 'nameAutomatically'>
  turnsOf: Turns['list']
  /** Rejects when the Provider can't answer. */
  runOneShot: ProviderHosts['runOneShot']
  vendorProgramFor: (provider: ProviderId) => SignInRequest
  publish: (event: AppEvent) => void
}

function visibleText(reply: Reply) {
  return reply.content
    .flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}

function titlePrompt(prompt: string, reply: string) {
  return [
    'Write a short title for the conversation below: a few words, with no quotes and no period at the end. Answer with the title alone.',
    `The user wrote:\n${prompt.slice(0, EXCERPT_LENGTH)}`,
    `The AI answered:\n${reply.slice(0, EXCERPT_LENGTH)}`,
  ].join('\n\n')
}

/** The answer's first line without quotes or markdown; '' when none is left. */
function cleanTitle(answer: string) {
  const line = answer
    .split('\n')
    .map(candidate => candidate.trim())
    .find(candidate => candidate !== '')

  return (line ?? '').replaceAll(EDGE_MARKS, '').slice(0, TREE_TITLE_MAX_LENGTH)
}

/**
 * Names a Tree once its first Reply finishes, by a one-shot on that Reply's
 * Provider. Never asked for again: a failure leaves the Tree untitled, and the
 * user's own title is final.
 */
export function createTitles({
  trees,
  turnsOf,
  runOneShot,
  vendorProgramFor,
  publish,
}: TitlesDeps) {
  function firstExchange({treeId, replyId, status}: FinishedReply) {
    if (!FINISHED.has(status) || trees.get(treeId)?.title !== null) return null

    const {prompts, replies} = turnsOf(treeId)
    const reply = replies.find(candidate => candidate.id === replyId)
    const prompt = prompts.find(candidate => candidate.id === reply?.promptId)

    return reply && prompt?.parentReplyId === null ? {prompt, reply} : null
  }

  return {
    async replyFinished(finished: FinishedReply): Promise<void> {
      const exchange = firstExchange(finished)

      if (!exchange) return

      const {provider, treeId} = finished
      let answer: string

      try {
        answer = await runOneShot(provider, {
          prompt: titlePrompt(
            exchange.prompt.text,
            visibleText(exchange.reply)
          ),
          vendorProgram: vendorProgramFor(provider),
        })
      } catch {
        return
      }

      const title = cleanTitle(answer)
      const named = title === '' ? null : trees.nameAutomatically(treeId, title)

      if (named) publish({type: 'TREE_CHANGED', tree: named})
    },
  }
}
