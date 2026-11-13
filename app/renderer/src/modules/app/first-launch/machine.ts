import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

/**
 * Which screen a launch shows: the Connections screen until a Provider is
 * connected.
 */
export type FirstLaunchState =
  | {status: 'loading'}
  | {status: 'connecting'}
  | {status: 'starting'}
  | {status: 'ready'}

export type FirstLaunchEvent =
  | {type: 'loaded'; anyConnected: boolean}
  | {type: 'startAsked'}
  | {type: 'started'}

export const initialFirstLaunch: FirstLaunchState = {status: 'loading'}

const transitions = {
  loading: {
    loaded: (_, {anyConnected}) =>
      anyConnected ? {status: 'ready'} : {status: 'connecting'},
  },
  connecting: {startAsked: () => ({status: 'starting'})},
  starting: {started: () => ({status: 'ready'})},
  ready: {},
} satisfies Transitions<FirstLaunchState, FirstLaunchEvent>

export const firstLaunchTransition = machine<
  FirstLaunchState,
  FirstLaunchEvent
>(transitions)
