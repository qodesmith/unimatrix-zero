import type {Transitions} from '@uz/contract/state-machine'

import {machine} from '@uz/contract/state-machine'

/**
 * Electron under the dev loop. `settling` waits for the bundles to stop
 * rebuilding; `restarting` waits for the killed Electron to exit.
 */
export type DevElectronState =
  | {status: 'running'}
  | {status: 'settling'; bundle: string; since: number}
  | {status: 'restarting'}
  | {status: 'stopping'}

export type DevElectronEvent =
  | {type: 'rebuilt'; bundle: string; at: number}
  | {type: 'settled'}
  | {type: 'exited'}
  | {type: 'stopAsked'}

export const initialDevElectron: DevElectronState = {status: 'running'}

function rebuilt(
  _state: DevElectronState,
  {bundle, at}: {bundle: string; at: number}
): DevElectronState {
  return {status: 'settling', bundle, since: at}
}

function stopping(): DevElectronState {
  return {status: 'stopping'}
}

const transitions = {
  running: {rebuilt, exited: stopping, stopAsked: stopping},
  settling: {
    rebuilt,
    settled: () => ({status: 'restarting'}),
    exited: stopping,
    stopAsked: stopping,
  },
  // The next Electron starts after this rebuild, so it loads the new bundle.
  restarting: {exited: () => initialDevElectron, stopAsked: stopping},
  stopping: {},
} satisfies Transitions<DevElectronState, DevElectronEvent>

export const devElectronTransition = machine<
  DevElectronState,
  DevElectronEvent
>(transitions)
