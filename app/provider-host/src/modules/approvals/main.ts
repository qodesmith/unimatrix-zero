import type {ReplyRequest} from '@uz/contract/host'
import type {ApprovalAction, ApprovalGrant} from '@uz/contract/permissions'
import type {ApprovalAnswer, ReplyEvent} from '@uz/contract/turns'

import {isInTreeFolder} from '#modules/tree-folder/main'
import {grantsFor, sameGrant, withGrants} from '@uz/contract/permissions'
import {randomUUID} from 'node:crypto'

export type ApprovalEvent = Extract<
  ReplyEvent,
  {type: 'APPROVAL_REQUESTED' | 'APPROVAL_RESOLVED'}
>

export interface Asking {
  action: ApprovalAction
  toolCallId?: string
  subagentId?: string
  /** Once it aborts, the card is dropped and the action doesn't go ahead. */
  signal?: AbortSignal
}

export interface ReplyApprovals {
  /** True to go ahead: already granted in the Tree, or allowed on the card. */
  ask(asking: Asking): Promise<boolean>
}

type ReplyOf = Pick<
  ReplyRequest,
  'treeId' | 'replyId' | 'grants' | 'treeFolder'
>

/**
 * An edit is granted when each of its paths is: by its own grant, or by
 * `edits-in-tree` when it lies in the Tree's files.
 */
function isGranted(
  grants: ApprovalGrant[],
  action: ApprovalAction,
  treeFolder: string
) {
  function has(wanted: ApprovalGrant) {
    return grants.some(grant => sameGrant(grant, wanted))
  }

  if (action.kind !== 'edit') return grantsFor(action).every(has)

  const editsInTree = has({kind: 'edits-in-tree'})

  return action.paths.every(
    path =>
      has({kind: 'edit', path}) ||
      (editsInTree && isInTreeFolder(treeFolder, path))
  )
}

/**
 * The cards waiting in one Provider host. An always-allow holds at once for
 * the Tree's other Replies here; main sends it with the Tree's later ones.
 */
export function createApprovals() {
  const waiting = new Map<string, (answer: ApprovalAnswer) => void>()
  const allowedInTree = new Map<string, ApprovalGrant[]>()

  async function answerTo(approvalId: string, signal?: AbortSignal) {
    const {promise, resolve} = Promise.withResolvers<ApprovalAnswer | null>()

    function dropped() {
      resolve(null)
    }

    waiting.set(approvalId, resolve)
    signal?.addEventListener('abort', dropped, {once: true})

    try {
      return signal?.aborted ? null : await promise
    } finally {
      waiting.delete(approvalId)
      signal?.removeEventListener('abort', dropped)
    }
  }

  function forReply(
    {treeId, replyId, grants, treeFolder}: ReplyOf,
    emit: (event: ApprovalEvent) => void
  ): ReplyApprovals {
    function granted(action: ApprovalAction) {
      return isGranted(
        [...grants, ...(allowedInTree.get(treeId) ?? [])],
        action,
        treeFolder
      )
    }

    return {
      async ask({action, toolCallId, subagentId, signal}) {
        if (granted(action)) return true

        const approvalId = randomUUID()
        const ids = {treeId, replyId, ...(subagentId ? {subagentId} : {})}

        emit({
          ...ids,
          type: 'APPROVAL_REQUESTED',
          approvalId,
          ...(toolCallId ? {toolCallId} : {}),
          action,
        })

        const answer = await answerTo(approvalId, signal)

        if (answer === null) return false

        if (answer === 'always-allow') {
          allowedInTree.set(
            treeId,
            withGrants(allowedInTree.get(treeId) ?? [], grantsFor(action))
          )
        }

        emit({...ids, type: 'APPROVAL_RESOLVED', approvalId, answer})

        return answer !== 'deny'
      },
    }
  }

  return {
    forReply,

    /** An answer to a card no longer waiting is dropped. */
    answer(approvalId: string, answer: ApprovalAnswer) {
      waiting.get(approvalId)?.(answer)
    },
  }
}

export type Approvals = ReturnType<typeof createApprovals>
