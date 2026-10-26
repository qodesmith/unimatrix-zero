import type {ChatEvent, ChatState} from './machine'

import {describe, expect, it} from 'vitest'

import {chatTransition, initialChat} from './machine'

const open = {
  status: 'open',
  turnId: 'p1',
  followReplyId: null,
} satisfies ChatState

const following = {
  status: 'open',
  turnId: 'p1',
  followReplyId: 'r2',
} satisfies ChatState

const closing = {status: 'closing', turnId: 'p1'} satisfies ChatState

// @ts-expect-error a closed slideout holds no Turn
void ({status: 'closed', turnId: 'p1'} satisfies ChatState)

describe('the chat slideout machine', () => {
  describe('closed', () => {
    it('opens at a Turn', () => {
      expect(
        chatTransition(initialChat, {type: 'opened', turnId: 'p1'})
      ).toEqual(open)
    })

    it('ignores every event but opened', () => {
      const events: ChatEvent[] = [
        {type: 'dismissed'},
        {type: 'slidOut'},
        {type: 'sent', replyId: 'r2'},
        {type: 'arrived', replyId: 'r2'},
      ]

      for (const event of events) {
        expect(chatTransition(initialChat, event)).toBe(initialChat)
      }
    })
  })

  describe('open', () => {
    it('switches to another Turn, dropping a Reply it was following', () => {
      expect(chatTransition(following, {type: 'opened', turnId: 'p3'})).toEqual(
        {status: 'open', turnId: 'p3', followReplyId: null}
      )
    })

    it('stays put when opened again at the same Turn', () => {
      expect(chatTransition(open, {type: 'opened', turnId: 'p1'})).toBe(open)
    })

    it('slides away on dismissal, keeping its Turn', () => {
      expect(chatTransition(following, {type: 'dismissed'})).toEqual(closing)
    })

    it('follows a Reply sent from it', () => {
      expect(chatTransition(open, {type: 'sent', replyId: 'r2'})).toEqual(
        following
      )
    })

    it('moves to the followed Reply once it arrives', () => {
      expect(
        chatTransition(following, {type: 'arrived', replyId: 'r2'})
      ).toEqual({status: 'open', turnId: 'r2', followReplyId: null})
    })

    it('ignores the arrival of a Reply it is not following', () => {
      expect(chatTransition(following, {type: 'arrived', replyId: 'r9'})).toBe(
        following
      )
      expect(chatTransition(open, {type: 'arrived', replyId: 'r2'})).toBe(open)
    })

    it('ignores slidOut', () => {
      expect(chatTransition(open, {type: 'slidOut'})).toBe(open)
    })
  })

  describe('closing', () => {
    it('closes once it has slid out', () => {
      expect(chatTransition(closing, {type: 'slidOut'})).toEqual(initialChat)
    })

    it('opens again at a Turn before it has slid out', () => {
      expect(chatTransition(closing, {type: 'opened', turnId: 'p3'})).toEqual({
        status: 'open',
        turnId: 'p3',
        followReplyId: null,
      })
    })

    it('ignores dismissed, sent and arrived', () => {
      const events: ChatEvent[] = [
        {type: 'dismissed'},
        {type: 'sent', replyId: 'r2'},
        {type: 'arrived', replyId: 'r2'},
      ]

      for (const event of events) {
        expect(chatTransition(closing, event)).toBe(closing)
      }
    })
  })
})
