import type {ConnectionsState} from '#modules/connections/main'

import {anyConnected} from '#modules/connections/main'
import {useStateMachine} from '#modules/state-machine/main'

import {startChatting} from './actions'
import {firstLaunchTransition, initialFirstLaunch} from './machine'

export function useFirstLaunch(
  connections: ConnectionsState,
  createTree: () => Promise<void>
) {
  const [firstLaunch, send] = useStateMachine({
    transition: firstLaunchTransition,
    initial: initialFirstLaunch,
  })

  if (firstLaunch.status === 'loading' && connections.loaded) {
    send({type: 'loaded', anyConnected: anyConnected(connections)})
  }

  function start() {
    if (
      firstLaunchTransition(firstLaunch, {type: 'startAsked'}) === firstLaunch
    ) {
      return
    }

    send({type: 'startAsked'})
    void startChatting({createTree, send})
  }

  return {status: firstLaunch.status, start}
}
