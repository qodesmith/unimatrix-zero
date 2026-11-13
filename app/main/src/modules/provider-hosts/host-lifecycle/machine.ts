import type {HostProcess} from '../host-process'
import type {Transitions} from '@uz/contract/state-machine'

import {machine} from '@uz/contract/state-machine'

/** Waits before each restart after a crash; after the last, the host stays down. */
export const RESTART_DELAYS_MS = [1000, 5000, 30_000]

/** `restarts` counts the crashes since the host last stayed up. */
export type HostState =
  | {status: 'starting'; child: HostProcess; restarts: number}
  | {
      status: 'ready'
      child: HostProcess
      restarts: number
      smallestModel: string | null
    }
  | {status: 'restarting'; restarts: number; delayMs: number}
  | {status: 'failed'}
  | {status: 'stopped'}

export type HostEvent =
  | {type: 'spawned'; child: HostProcess}
  | {type: 'becameReady'; smallestModel: string | null}
  | {type: 'stayedUp'}
  | {type: 'exited'}
  | {type: 'stopped'}

export function startingHost(child: HostProcess): HostState {
  return {status: 'starting', child, restarts: 0}
}

function exited({restarts}: {restarts: number}): HostState {
  const delayMs = RESTART_DELAYS_MS[restarts]

  return delayMs === undefined
    ? {status: 'failed'}
    : {status: 'restarting', restarts: restarts + 1, delayMs}
}

function stopped(): HostState {
  return {status: 'stopped'}
}

const transitions = {
  starting: {
    becameReady: ({child, restarts}, {smallestModel}) => ({
      status: 'ready',
      child,
      restarts,
      smallestModel,
    }),
    exited,
    stopped,
  },
  ready: {
    stayedUp: state => ({...state, restarts: 0}),
    exited,
    stopped,
  },
  restarting: {
    spawned: ({restarts}, {child}) => ({status: 'starting', child, restarts}),
    stopped,
  },
  failed: {stopped},
  stopped: {},
} satisfies Transitions<HostState, HostEvent>

export const hostTransition = machine<HostState, HostEvent>(transitions)

/** The running process, which only a starting or ready host has. */
export function childOf(state: HostState): HostProcess | null {
  switch (state.status) {
    case 'starting':
    case 'ready':
      return state.child
    case 'restarting':
    case 'failed':
    case 'stopped':
      return null
    default:
      throw new Error('Unknown host state.')
  }
}
