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
  runStarted: {type: 'runStarted'},
  runFinished: {type: 'runFinished'},
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

    it('waits through a run starting, so a Stop asked before it stays asked', () => {
      expect(replyRunTransition(stopping, EVENTS.runStarted)).toBe(stopping)
    })

    it('goes idle once the run finishes', () => {
      expect(replyRunTransition(stopping, EVENTS.runFinished)).toEqual(
        initialReplyRun
      )
    })

    it('ignores asking again, so Esc twice sends one Stop', () => {
      expect(movedBy(stopping, ['stopRefused', 'runFinished'])).toEqual([])
    })
  })

  describe('stopRefused', () => {
    it('stops again when asked, dropping the reason', () => {
      expect(replyRunTransition(stopRefused, EVENTS.stopAsked)).toEqual(
        stopping
      )
    })

    it('drops the reason once a run starts or finishes', () => {
      expect(replyRunTransition(stopRefused, EVENTS.runStarted)).toEqual(
        initialReplyRun
      )
      expect(replyRunTransition(stopRefused, EVENTS.runFinished)).toEqual(
        initialReplyRun
      )
    })

    it('ignores everything else', () => {
      expect(
        movedBy(stopRefused, ['stopAsked', 'runStarted', 'runFinished'])
      ).toEqual([])
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

    it('waits through the new run starting before main answers', () => {
      expect(replyRunTransition(retrying, EVENTS.runStarted)).toBe(retrying)
    })

    it('goes idle once a run finishes', () => {
      expect(replyRunTransition(retrying, EVENTS.runFinished)).toEqual(
        initialReplyRun
      )
    })

    it('ignores asking again, so a double click sends one Retry', () => {
      expect(
        movedBy(retrying, ['retryAccepted', 'retryRefused', 'runFinished'])
      ).toEqual([])
    })
  })

  describe('retryRefused', () => {
    it('retries again when asked, dropping the reason', () => {
      expect(replyRunTransition(retryRefused, EVENTS.retryAsked)).toEqual(
        retrying
      )
    })

    it('drops the reason once a run starts or finishes', () => {
      expect(replyRunTransition(retryRefused, EVENTS.runStarted)).toEqual(
        initialReplyRun
      )
      expect(replyRunTransition(retryRefused, EVENTS.runFinished)).toEqual(
        initialReplyRun
      )
    })

    it('ignores everything else', () => {
      expect(
        movedBy(retryRefused, ['retryAsked', 'runStarted', 'runFinished'])
      ).toEqual([])
    })
  })

  it('keeps a Stop asked after main took a Retry but before its run started', () => {
    const events = [
      EVENTS.retryAsked,
      EVENTS.retryAccepted,
      EVENTS.stopAsked,
      EVENTS.runStarted,
    ]

    expect(events.reduce(replyRunTransition, initialReplyRun)).toEqual(stopping)
  })
})
