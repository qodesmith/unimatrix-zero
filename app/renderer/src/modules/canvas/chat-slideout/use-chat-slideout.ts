import type {TreeIndex} from '../tree'

import {useStateMachine} from '#modules/state-machine/main'
import {useCallback} from 'react'

import {replyOf} from '../tree'
import {chatTransition, initialChat} from './machine'

/** The chat slideout over one Tree's canvas. */
export function useChatSlideout(index: TreeIndex) {
  const [chat, send] = useStateMachine({
    transition: chatTransition,
    initial: initialChat,
  })

  if (
    chat.status === 'open' &&
    chat.followReplyId !== null &&
    index.replyById.has(chat.followReplyId)
  ) {
    send({type: 'arrived', replyId: chat.followReplyId})
  }

  /** A Prompt with no Reply yet has no Thread, so it opens nothing. */
  const openAt = useCallback(
    (turnId: string) => {
      if (replyOf(index, turnId)) send({type: 'opened', turnId})
    },
    [index, send]
  )

  const dismiss = useCallback(() => send({type: 'dismissed'}), [send])
  const slidOut = useCallback(() => send({type: 'slidOut'}), [send])

  const follow = useCallback(
    (replyId: string) => send({type: 'sent', replyId}),
    [send]
  )

  return {
    turnId: chat.status === 'closed' ? null : chat.turnId,
    end: chat.status === 'closed' ? null : replyOf(index, chat.turnId),
    open: chat.status === 'open',
    openAt,
    dismiss,
    slidOut,
    follow,
  }
}
