import type {StopState} from './machine'

import {describe, expect, it} from 'vitest'

import {initialStop, stopTransition} from './machine'

const stopping = {status: 'stopping'} satisfies StopState

const refused = {status: 'refused', error: 'Not running'} satisfies StopState

// @ts-expect-error a refused Stop carries main's reason
void ({status: 'refused'} satisfies StopState)

describe('the Stop machine', () => {
  describe('streaming', () => {
    it('starts stopping when asked', () => {
      expect(stopTransition(initialStop, {type: 'asked'})).toEqual(stopping)
    })

    it('ignores a refusal that arrives after the run finished', () => {
      expect(
        stopTransition(initialStop, {type: 'refused', error: 'Not running'})
      ).toBe(initialStop)
    })
  })

  describe('stopping', () => {
    it('ignores asking again, so Esc twice sends one Stop', () => {
      const once = stopTransition(initialStop, {type: 'asked'})

      expect(stopTransition(once, {type: 'asked'})).toBe(once)
    })

    it('holds main’s reason when refused', () => {
      expect(
        stopTransition(stopping, {type: 'refused', error: 'Not running'})
      ).toEqual(refused)
    })
  })

  describe('refused', () => {
    it('stops again when asked, dropping the reason', () => {
      expect(stopTransition(refused, {type: 'asked'})).toEqual(stopping)
    })

    it('ignores another refusal', () => {
      expect(stopTransition(refused, {type: 'refused', error: 'Other'})).toBe(
        refused
      )
    })
  })
})
