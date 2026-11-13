import type {HostProcess} from '../host-process'
import type {HostEvent, HostState} from './machine'

import {describe, expect, it} from 'vitest'

import {
  RESTART_DELAYS_MS,
  childOf,
  hostTransition,
  startingHost,
} from './machine'

function fakeChild(): HostProcess {
  return {
    post: () => undefined,
    onMessage: () => undefined,
    onExit: () => undefined,
    kill: () => undefined,
  }
}

const child = fakeChild()
const next = fakeChild()

const starting = {status: 'starting', child, restarts: 1} satisfies HostState

const ready = {
  status: 'ready',
  child,
  restarts: 1,
  smallestModel: 'small',
} satisfies HostState

const restarting = {
  status: 'restarting',
  restarts: 2,
  delayMs: 5000,
} satisfies HostState

const failed = {status: 'failed'} satisfies HostState
const stopped = {status: 'stopped'} satisfies HostState

// @ts-expect-error a host waiting to restart has no process
void ({...restarting, child} satisfies HostState)

// @ts-expect-error only a ready host knows its smallest Model
void ({...starting, smallestModel: 'small'} satisfies HostState)

const ALL: HostEvent[] = [
  {type: 'spawned', child: next},
  {type: 'becameReady', smallestModel: 'tiny'},
  {type: 'stayedUp'},
  {type: 'exited'},
  {type: 'stopped'},
]

function except(...types: HostEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

/** Crashes a starting host that has already crashed `restarts` times. */
function crashAfter(restarts: number) {
  return hostTransition({...starting, restarts}, {type: 'exited'})
}

describe('the host lifecycle machine', () => {
  it('starts with its process and no crash counted', () => {
    expect(startingHost(child)).toEqual({
      status: 'starting',
      child,
      restarts: 0,
    })
  })

  describe('starting', () => {
    it('is ready on its smallest Model once the host says so, keeping its crash count', () => {
      expect(
        hostTransition(starting, {type: 'becameReady', smallestModel: 'tiny'})
      ).toEqual({status: 'ready', child, restarts: 1, smallestModel: 'tiny'})
    })

    it('waits the next delay before each restart, then stays down', () => {
      expect(
        RESTART_DELAYS_MS.map((_, crashes) => crashAfter(crashes))
      ).toEqual(
        RESTART_DELAYS_MS.map((delayMs, crashes) => ({
          status: 'restarting',
          restarts: crashes + 1,
          delayMs,
        }))
      )
      expect(crashAfter(RESTART_DELAYS_MS.length)).toEqual(failed)
    })

    it('stops', () => {
      expect(hostTransition(starting, {type: 'stopped'})).toEqual(stopped)
    })

    it('ignores a second process and staying up', () => {
      for (const event of except('becameReady', 'exited', 'stopped')) {
        expect(hostTransition(starting, event)).toBe(starting)
      }
    })
  })

  describe('ready', () => {
    it('starts the backoff over once it has stayed up', () => {
      expect(hostTransition(ready, {type: 'stayedUp'})).toEqual({
        ...ready,
        restarts: 0,
      })
    })

    it('restarts after the wait its crash count names', () => {
      expect(hostTransition(ready, {type: 'exited'})).toEqual(restarting)
    })

    it('stays down when it crashes after its last restart', () => {
      expect(
        hostTransition(
          {...ready, restarts: RESTART_DELAYS_MS.length},
          {type: 'exited'}
        )
      ).toEqual(failed)
    })

    it('stops', () => {
      expect(hostTransition(ready, {type: 'stopped'})).toEqual(stopped)
    })

    it('ignores a second process and being told it is ready again', () => {
      for (const event of except('stayedUp', 'exited', 'stopped')) {
        expect(hostTransition(ready, event)).toBe(ready)
      }
    })
  })

  describe('restarting', () => {
    it('starts on the new process, keeping its crash count', () => {
      expect(
        hostTransition(restarting, {type: 'spawned', child: next})
      ).toEqual({status: 'starting', child: next, restarts: 2})
    })

    it('stops', () => {
      expect(hostTransition(restarting, {type: 'stopped'})).toEqual(stopped)
    })

    it('ignores what only a running process can do', () => {
      for (const event of except('spawned', 'stopped')) {
        expect(hostTransition(restarting, event)).toBe(restarting)
      }
    })
  })

  describe('failed', () => {
    it('stops', () => {
      expect(hostTransition(failed, {type: 'stopped'})).toEqual(stopped)
    })

    it('stays down whatever else happens', () => {
      for (const event of except('stopped')) {
        expect(hostTransition(failed, event)).toBe(failed)
      }
    })
  })

  describe('stopped', () => {
    it('ignores every event, a late restart included', () => {
      for (const event of ALL) {
        expect(hostTransition(stopped, event)).toBe(stopped)
      }
    })
  })

  it('has a process only while starting or ready', () => {
    expect(
      [starting, ready, restarting, failed, stopped].map(state =>
        childOf(state)
      )
    ).toEqual([child, child, null, null, null])
  })
})
