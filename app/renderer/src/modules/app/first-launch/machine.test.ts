import type {FirstLaunchEvent, FirstLaunchState} from './machine'

import {describe, expect, it} from 'vitest'

import {firstLaunchTransition, initialFirstLaunch} from './machine'

const connecting = {status: 'connecting'} satisfies FirstLaunchState
const starting = {status: 'starting'} satisfies FirstLaunchState
const ready = {status: 'ready'} satisfies FirstLaunchState

const ALL: FirstLaunchEvent[] = [
  {type: 'loaded', anyConnected: false},
  {type: 'loaded', anyConnected: true},
  {type: 'startAsked'},
  {type: 'started'},
]

function except(...types: FirstLaunchEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the first launch machine', () => {
  describe('loading', () => {
    it('asks for a connection when no Provider is connected', () => {
      expect(
        firstLaunchTransition(initialFirstLaunch, {
          type: 'loaded',
          anyConnected: false,
        })
      ).toEqual(connecting)
    })

    it('is ready when a Provider is connected', () => {
      expect(
        firstLaunchTransition(initialFirstLaunch, {
          type: 'loaded',
          anyConnected: true,
        })
      ).toEqual(ready)
    })

    it('ignores every event but loaded', () => {
      for (const event of except('loaded')) {
        expect(firstLaunchTransition(initialFirstLaunch, event)).toBe(
          initialFirstLaunch
        )
      }
    })
  })

  describe('connecting', () => {
    it('starts once asked', () => {
      expect(firstLaunchTransition(connecting, {type: 'startAsked'})).toEqual(
        starting
      )
    })

    it('stays through a Provider connecting, and ignores a start it did not ask for', () => {
      for (const event of except('startAsked')) {
        expect(firstLaunchTransition(connecting, event)).toBe(connecting)
      }
    })
  })

  describe('starting', () => {
    it('is ready once started', () => {
      expect(firstLaunchTransition(starting, {type: 'started'})).toEqual(ready)
    })

    it('ignores being asked to start again', () => {
      for (const event of except('started')) {
        expect(firstLaunchTransition(starting, event)).toBe(starting)
      }
    })
  })

  describe('ready', () => {
    it('ignores every event, so a Provider disconnecting later does not bring the screen back', () => {
      for (const event of ALL) {
        expect(firstLaunchTransition(ready, event)).toBe(ready)
      }
    })
  })
})
