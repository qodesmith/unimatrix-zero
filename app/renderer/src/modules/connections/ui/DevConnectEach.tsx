import type {ConnectionsControls} from '../use-connections'

import {Button} from '#shadcn/ui/button'
import {ProviderIdSchema} from '@uz/contract/providers'

import {cardOf} from '../cards'
import {connectEach} from '../connect-each'
import {useConnectionsStore} from '../use-connections'

/** Rendered only under `import.meta.env.DEV`, so no packaged build has it. */
export function DevConnectEach({
  connections,
}: {
  connections: ConnectionsControls
}) {
  const store = useConnectionsStore()
  const {state, connect} = connections

  const notConnected = ProviderIdSchema.options.filter(
    provider => cardOf(state, provider).kind !== 'connected'
  )

  if (!state.loaded || state.signIn || notConnected.length < 2) return null

  return (
    <Button variant="outline" onClick={() => void connectEach(store, connect)}>
      Connect both (dev)
    </Button>
  )
}
