import type {Card} from '../cards'
import type {ProviderId} from '@uz/contract/providers'

import {Badge} from '#shadcn/ui/badge'
import {Button} from '#shadcn/ui/button'
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  Card as CardRoot,
  CardTitle,
} from '#shadcn/ui/card'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {cn} from 'cn'
import {CheckIcon} from 'lucide-react'

import {ABOUT, failureLine} from '../about'
import {Checklist} from './SignInSteps'

interface CardActions {
  connect: () => void
  cancel: () => void
  openPage: () => void
  submitCode: (code: string) => void
}

interface ProviderCardProps extends CardActions {
  provider: ProviderId
  card: Card
  /** Another Provider is being connected; only one connects at a time. */
  waitingFor: ProviderId | null
}

export function ProviderCard({
  provider,
  card,
  waitingFor,
  ...actions
}: ProviderCardProps) {
  const name = PROVIDER_NAMES[provider]
  const about = ABOUT[provider]

  return (
    <CardRoot
      role="region"
      aria-label={name}
      data-state={card.kind}
      className="w-80 gap-5 data-[state=connected]:ring-2 data-[state=connected]:ring-success data-[state=failed]:ring-2 data-[state=failed]:ring-destructive/40"
    >
      <CardHeader className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary text-2xl text-primary-foreground"
        >
          {about.mark}
        </span>
        <div>
          <CardTitle>
            <h2 className="text-xl font-semibold">{name}</h2>
          </CardTitle>
          <CardDescription>
            {about.plans} · by {about.company}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <CardBody provider={provider} card={card} {...actions} />
      </CardContent>
      <CardFooter className="mt-auto flex-col items-stretch gap-2">
        <CardAction
          provider={provider}
          card={card}
          waitingFor={waitingFor}
          {...actions}
        />
        <WaitingNote
          provider={provider}
          card={card}
          waitingFor={waitingFor}
          className="text-center"
        />
      </CardFooter>
    </CardRoot>
  )
}

/** A card's connect flow without the card around it, for Settings. */
export function Connect({
  provider,
  card,
  waitingFor,
  ...actions
}: ProviderCardProps) {
  return (
    <div className="flex flex-col gap-4">
      <CardBody provider={provider} card={card} {...actions} />
      <div className="flex flex-col items-start gap-2">
        <CardAction
          provider={provider}
          card={card}
          waitingFor={waitingFor}
          {...actions}
        />
        <WaitingNote provider={provider} card={card} waitingFor={waitingFor} />
      </div>
    </div>
  )
}

function WaitingNote({
  provider,
  card,
  waitingFor,
  className,
}: {
  provider: ProviderId
  card: Card
  waitingFor: ProviderId | null
  className?: string
}) {
  if (!waitingFor || (card.kind !== 'idle' && card.kind !== 'failed')) {
    return null
  }

  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      You can connect {PROVIDER_NAMES[provider]} once{' '}
      {PROVIDER_NAMES[waitingFor]} is done.
    </p>
  )
}

function CardBody({
  provider,
  card,
  ...actions
}: {provider: ProviderId; card: Card} & CardActions) {
  const name = PROVIDER_NAMES[provider]

  if (card.kind === 'connecting') {
    return <Checklist provider={provider} card={card} {...actions} />
  }

  if (card.kind === 'failed') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {failureLine(provider, card.failure)}
      </p>
    )
  }

  if (card.kind === 'connected') {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg bg-success/10 p-4 text-center">
        <CheckIcon aria-hidden className="size-6 text-success" />
        <p className="font-medium">Connected</p>
        <p className="text-sm text-muted-foreground">{card.account.email}</p>
        <Badge
          variant="outline"
          className="bg-background text-muted-foreground"
        >
          {name} {card.account.plan}
        </Badge>
      </div>
    )
  }

  return (
    <p className="text-sm text-muted-foreground">
      Sign in with your {name} account. Your browser opens {name}’s page; we
      never see your password.
    </p>
  )
}

function CardAction({
  provider,
  card,
  waitingFor,
  connect,
  cancel,
}: {
  provider: ProviderId
  card: Card
  waitingFor: ProviderId | null
} & CardActions) {
  const name = PROVIDER_NAMES[provider]

  if (card.kind === 'connected') return null

  if (card.kind === 'connecting') {
    return (
      <Button variant="outline" onClick={cancel}>
        Cancel
      </Button>
    )
  }

  return (
    <Button size="lg" disabled={waitingFor !== null} onClick={connect}>
      {card.kind === 'idle'
        ? `Connect ${name}`
        : card.failure.reason === 'plan-refused'
          ? 'Use a different account'
          : 'Try again'}
    </Button>
  )
}
