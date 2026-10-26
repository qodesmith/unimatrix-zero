import type {ReplyRunEvent, ReplyRunState} from './machine'

import {describe, expect, it} from 'vitest'

import {initialReplyRun, replyRunTransition} from './machine'

const stopping = {status: 'stopping'} satisfies ReplyRunState

const stopRefused = {
  status: 'stopRefused',
  error: 'Not running',
} satisfies ReplyRunState

const retrying = {status: 'retrying'} satisfies ReplyRunState

const retryRefused = {
  status: 'retryRefused',
  error: 'Connect Claude to retry.',
} satisfies ReplyRunState

// @ts-expect-error a refused Stop carries main's reason
void ({status: 'stopRefused'} satisfies ReplyRunState)

// @ts-expect-error a refused Retry carries main's reason
void ({status: 'retryRefused'} satisfies ReplyRunState)

const EVENTS = {
  stopAsked: {type: 'stopAsked'},
  stopRefused: {type: 'stopRefused', error: 'Not running'},
  retryAsked: {type: 'retryAsked'},
  retryAccepted: {type: 'retryAccepted'},
  retryRefused: {type: 'retryRefused', error: 'Connect Claude to retry.'},
} satisfies Record<ReplyRunEvent['type'], ReplyRunEvent>

/** The events besides `taken` that return anything but the same state. */
function movedBy(state: ReplyRunState, taken: ReplyRunEvent['type'][]) {
  return Object.entries(EVENTS).flatMap(([type, event]) =>
    taken.some(one => one === type) ||
    replyRunTransition(state, event) === state
      ? []
      : [type]
  )
}

describe('the Reply run machine', () => {
  describe('idle', () => {
    it('starts stopping when a Stop is asked', () => {
      expect(replyRunTransition(initialReplyRun, EVENTS.stopAsked)).toEqual(
        stopping
      )
    })

    it('starts retrying when a Retry is asked', () => {
      expect(replyRunTransition(initialReplyRun, EVENTS.retryAsked)).toEqual(
        retrying
      )
    })

    it('ignores answers that arrive after a run started or finished', () => {
      expect(movedBy(initialReplyRun, ['stopAsked', 'retryAsked'])).toEqual([])
    })
  })

  describe('stopping', () => {
    it('holds main’s reason when the Stop is refused', () => {
      expect(replyRunTransition(stopping, EVENTS.stopRefused)).toEqual(
        stopRefused
      )
    })

    it('ignores asking again, so Esc twice sends one Stop', () => {
      expect(movedBy(stopping, ['stopRefused'])).toEqual([])
    })
  })

  describe('stopRefused', () => {
    it('stops again when asked, dropping the reason', () => {
      expect(replyRunTransition(stopRefused, EVENTS.stopAsked)).toEqual(
        stopping
      )
    })

    it('ignores everything else', () => {
      expect(movedBy(stopRefused, ['stopAsked'])).toEqual([])
    })
  })

  describe('retrying', () => {
    it('goes idle once main takes the Retry, so the new run can be stopped', () => {
      expect(replyRunTransition(retrying, EVENTS.retryAccepted)).toBe(
        initialReplyRun
      )
    })

    it('holds main’s reason when the Retry is refused', () => {
      expect(replyRunTransition(retrying, EVENTS.retryRefused)).toEqual(
        retryRefused
      )
    })

    it('ignores asking again, so a double click sends one Retry', () => {
      expect(movedBy(retrying, ['retryAccepted', 'retryRefused'])).toEqual([])
    })
  })

  describe('retryRefused', () => {
    it('retries again when asked, dropping the reason', () => {
      expect(replyRunTransition(retryRefused, EVENTS.retryAsked)).toEqual(
        retrying
      )
    })

    it('ignores everything else', () => {
      expect(movedBy(retryRefused, ['retryAsked'])).toEqual([])
    })
  })
})
