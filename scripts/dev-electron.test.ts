import type {DevElectronEvent, DevElectronState} from './dev-electron'

import {describe, expect, it} from 'vitest'

import {devElectronTransition, initialDevElectron} from './dev-electron'

const settling = {
  status: 'settling',
  bundle: 'main',
  since: 1000,
} satisfies DevElectronState

const restarting = {status: 'restarting'} satisfies DevElectronState
const stopping = {status: 'stopping'} satisfies DevElectronState

const ALL: DevElectronEvent[] = [
  {type: 'rebuilt', bundle: 'preload', at: 1200},
  {type: 'settled'},
  {type: 'exited'},
  {type: 'stopAsked'},
]

function except(...types: DevElectronEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

function after(...events: DevElectronEvent[]) {
  return events.reduce(devElectronTransition, initialDevElectron)
}

describe('the dev Electron machine', () => {
  describe('running', () => {
    it('waits for the bundles to settle once one is rebuilt', () => {
      expect(
        devElectronTransition(initialDevElectron, {
          type: 'rebuilt',
          bundle: 'main',
          at: 1000,
        })
      ).toEqual(settling)
    })

    it('stops dev when Electron exits by itself or a stop is asked', () => {
      expect(after({type: 'exited'})).toEqual(stopping)
      expect(after({type: 'stopAsked'})).toEqual(stopping)
    })

    it('ignores a settle it is not waiting for', () => {
      expect(devElectronTransition(initialDevElectron, {type: 'settled'})).toBe(
        initialDevElectron
      )
    })
  })

  describe('settling', () => {
    it('waits again from each further rebuild, the same bundle’s included', () => {
      expect(
        devElectronTransition(settling, {
          type: 'rebuilt',
          bundle: 'preload',
          at: 1200,
        })
      ).toEqual({status: 'settling', bundle: 'preload', since: 1200})
      expect(
        devElectronTransition(settling, {
          type: 'rebuilt',
          bundle: 'main',
          at: 1200,
        })
      ).not.toBe(settling)
    })

    it('restarts once settled', () => {
      expect(devElectronTransition(settling, {type: 'settled'})).toEqual(
        restarting
      )
    })

    it('stops dev when Electron exits by itself or a stop is asked', () => {
      expect(devElectronTransition(settling, {type: 'exited'})).toEqual(
        stopping
      )
      expect(devElectronTransition(settling, {type: 'stopAsked'})).toEqual(
        stopping
      )
    })
  })

  describe('restarting', () => {
    it('runs again once the killed Electron has exited', () => {
      expect(devElectronTransition(restarting, {type: 'exited'})).toEqual(
        initialDevElectron
      )
    })

    it('stops dev when asked', () => {
      expect(devElectronTransition(restarting, {type: 'stopAsked'})).toEqual(
        stopping
      )
    })

    it('ignores a rebuild and a settle, so one exit starts one Electron', () => {
      for (const event of except('exited', 'stopAsked')) {
        expect(devElectronTransition(restarting, event)).toBe(restarting)
      }
    })
  })

  describe('stopping', () => {
    it('ignores every event, so nothing starts Electron again', () => {
      for (const event of ALL) {
        expect(devElectronTransition(stopping, event)).toBe(stopping)
      }
    })
  })

  it('starts one Electron for two rebuilds that settle while the first is still exiting', () => {
    const rebuiltMain = {type: 'rebuilt', bundle: 'main', at: 0} as const
    const rebuiltHosts = {type: 'rebuilt', bundle: 'hosts', at: 400} as const

    expect(
      after(rebuiltMain, {type: 'settled'}, rebuiltHosts, {type: 'settled'})
    ).toEqual(restarting)
  })

  it('stays stopped through a rebuild that settles after a stop was asked', () => {
    expect(
      after(
        {type: 'rebuilt', bundle: 'main', at: 0},
        {type: 'stopAsked'},
        {type: 'settled'},
        {type: 'exited'}
      )
    ).toEqual(stopping)
  })
})
