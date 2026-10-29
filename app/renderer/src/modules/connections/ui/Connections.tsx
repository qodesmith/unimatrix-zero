import type {ConnectionsControls} from '../use-connections'

import {Button} from '#modules/shadcn/main'
import {ProviderIdSchema} from '@uz/contract/providers'

import {anyConnected, cardOf} from '../cards'
import {ProviderCard} from './ProviderCard'

interface ConnectionsProps {
  connections: ConnectionsControls
  /** First launch only: the introduction, and "Start chatting" once ready. */
  onStart?: () => void
  onBack?: () => void
}

export function Connections({connections, onStart, onBack}: ConnectionsProps) {
  const {state} = connections
  const connecting = state.signIn?.provider ?? null

  return (
    <div className="relative flex min-h-full w-full flex-col items-center gap-8 bg-background p-8">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-4 left-4"
          onClick={onBack}
        >
          ← Back to your Tree
        </Button>
      )}
      <div className="max-w-xl text-center">
        {onStart && (
          <p className="mb-4 text-lg text-muted-foreground">
            Talk with Claude or ChatGPT, and branch any conversation into as
            many directions as you like. It uses the plan you already pay for.
          </p>
        )}
        <h1 className="text-3xl font-bold">
          {onStart ? 'Connect the AI you already pay for' : 'Connections'}
        </h1>
        {onStart && (
          <p className="mt-2 text-muted-foreground">
            One is enough to start. You can connect the other any time.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-center gap-6">
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
