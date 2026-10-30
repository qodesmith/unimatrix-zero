import type {ConnectionsControls} from '../use-connections'

import {Button, cn} from '#modules/shadcn/main'
import {ProviderIdSchema} from '@uz/contract/providers'

import {anyConnected, cardOf} from '../cards'
import {ProviderCard} from './ProviderCard'

interface ConnectionsProps {
  connections: ConnectionsControls
  /**
   * First launch only: the introduction, and "Start chatting" once ready.
   * Without it, only the cards.
   */
  onStart?: () => void
}

export function Connections({connections, onStart}: ConnectionsProps) {
  const {state} = connections
  const connecting = state.signIn?.provider ?? null

  return (
    <div
      className={cn(
        'flex w-full flex-col gap-8',
        onStart && 'min-h-full items-center bg-background p-8'
      )}
    >
      {onStart && (
        <div className="max-w-xl text-center">
          <p className="mb-4 text-lg text-muted-foreground">
            Talk with Claude or ChatGPT, and branch any conversation into as
            many directions as you like. It uses the plan you already pay for.
          </p>
          <h1 className="text-3xl font-bold">
            Connect the AI you already pay for
          </h1>
          <p className="mt-2 text-muted-foreground">
            One is enough to start. You can connect the other any time.
          </p>
        </div>
      )}
      <div
        className={cn(
          'flex flex-wrap items-start gap-6',
          onStart && 'justify-center'
        )}
      >
        {ProviderIdSchema.options.map(provider => (
          <ProviderCard
            key={provider}
            provider={provider}
            card={cardOf(state, provider)}
            waitingFor={
              connecting !== null && connecting !== provider ? connecting : null
            }
            connect={() => void connections.connect(provider)}
            cancel={() => void connections.cancel(provider)}
            openPage={() => void connections.openPage(provider)}
            submitCode={code => void connections.submitCode(provider, code)}
          />
        ))}
      </div>
      {onStart && (
        <Button size="lg" disabled={!anyConnected(state)} onClick={onStart}>
          Start chatting →
        </Button>
      )}
    </div>
  )
}
