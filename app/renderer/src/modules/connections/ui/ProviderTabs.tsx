import type {Card} from '../cards'
import type {ConnectionsControls} from '../use-connections'
import type {ProviderId} from '@uz/contract/providers'
import type {ComponentType} from 'react'

import {Badge} from '#shadcn/ui/badge'
import {Separator} from '#shadcn/ui/separator'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '#shadcn/ui/tabs'
import {PROVIDER_NAMES, ProviderIdSchema} from '@uz/contract/providers'
import {cn} from 'cn'

import {ABOUT} from '../about'
import {cardOf} from '../cards'
import {SignIn} from './ProviderCard'

interface ProviderTabsProps {
  connections: ConnectionsControls
  /** Shown in each Provider's tab, under its account. */
  providerSettings: ComponentType<{provider: ProviderId}>
}

/** Settings' Connections: a tab for each Provider, its account and settings. */
export function ProviderTabs({
  connections,
  providerSettings: ProviderSettings,
}: ProviderTabsProps) {
  const {state} = connections
  const connecting = state.signIn?.provider ?? null

  return (
    <Tabs defaultValue={ProviderIdSchema.options[0]} className="gap-6">
      <TabsList variant="line" className="w-full justify-start border-b">
        {ProviderIdSchema.options.map(provider => (
          <TabsTrigger
            key={provider}
            value={provider}
            className="flex-none px-3"
          >
            <span aria-hidden>{ABOUT[provider].mark}</span>
            {PROVIDER_NAMES[provider]}
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                cardOf(state, provider).kind === 'connected'
                  ? 'bg-success'
                  : 'bg-muted-foreground/40'
              )}
            />
          </TabsTrigger>
        ))}
      </TabsList>
      {ProviderIdSchema.options.map(provider => {
        const card = cardOf(state, provider)

        return (
          <TabsContent
            key={provider}
            value={provider}
            className="flex flex-col gap-6"
          >
            {card.kind === 'connected' ? (
              <Account provider={provider} card={card} />
            ) : (
              <SignIn
                provider={provider}
                card={card}
                waitingFor={
                  connecting !== null && connecting !== provider
                    ? connecting
                    : null
                }
                connect={() => void connections.connect(provider)}
                cancel={() => void connections.cancel(provider)}
                openPage={() => void connections.openPage(provider)}
                submitCode={code => void connections.submitCode(provider, code)}
              />
            )}
            <Separator />
            <ProviderSettings provider={provider} />
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

function Account({
  provider,
  card,
}: {
  provider: ProviderId
  card: Extract<Card, {kind: 'connected'}>
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">Signed in</span>
        <span className="truncate text-muted-foreground">
          {card.account.email} · {PROVIDER_NAMES[provider]} {card.account.plan}
        </span>
      </div>
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        Connected
      </Badge>
    </div>
  )
}
