import type {Card} from '../cards'
import type {
  ProviderId,
  SignInFailure,
  SignInStep,
} from '@uz/contract/providers'

import {Button} from '#modules/shadcn/main'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {useState} from 'react'

const ABOUT: Record<
  ProviderId,
  {plans: string; company: string; mark: string; program: string}
> = {
  claude: {
    plans: 'Pro or Max',
    company: 'Anthropic',
    mark: '✳',
    program: 'Claude Code',
  },
  chatgpt: {
    plans: 'Plus or Pro',
    company: 'OpenAI',
    mark: '◎',
    program: 'Codex',
  },
}

type Step = SignInStep['step']

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

/** One Provider: Connect, the checklist while it connects, then its account. */
export function ProviderCard({
  provider,
  card,
  waitingFor,
  ...actions
}: ProviderCardProps) {
  const name = PROVIDER_NAMES[provider]
  const about = ABOUT[provider]

  return (
    <section
      aria-label={name}
      data-state={card.kind}
      className="flex w-80 flex-col gap-5 rounded-xl border-2 border-transparent bg-card p-6 text-card-foreground shadow-sm data-[state=connected]:border-success data-[state=failed]:border-destructive/40"
    >
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary text-2xl text-primary-foreground"
        >
          {about.mark}
        </span>
        <div>
          <h2 className="text-xl font-semibold">{name}</h2>
          <p className="text-sm text-muted-foreground">
            {about.plans} · by {about.company}
          </p>
        </div>
      </header>
      <CardBody provider={provider} card={card} {...actions} />
      <footer className="mt-auto flex flex-col gap-2">
        <CardAction
          provider={provider}
          card={card}
          waitingFor={waitingFor}
          {...actions}
        />
        {waitingFor && (card.kind === 'idle' || card.kind === 'failed') && (
          <p className="text-center text-xs text-muted-foreground">
            You can connect {name} once {PROVIDER_NAMES[waitingFor]} is done.
          </p>
        )}
      </footer>
    </section>
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
        {FAILURE_LINES[card.failure.reason](provider, card.failure)}
      </p>
    )
  }

  if (card.kind === 'connected') {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg bg-success/10 p-4 text-center">
        <span aria-hidden className="text-2xl text-success">
          ✓
        </span>
        <p className="font-medium">Connected</p>
        <p className="text-sm text-muted-foreground">{card.account.email}</p>
        <p className="rounded-full bg-background px-2 text-xs text-muted-foreground">
          {name} {card.account.plan}
        </p>
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

function Checklist({
  provider,
  card,
  openPage,
  submitCode,
}: {
  provider: ProviderId
  card: Extract<Card, {kind: 'connecting'}>
} & CardActions) {
  const name = PROVIDER_NAMES[provider]
  const {step} = card

  const steps: {step: Step; label: string}[] = [
    {step: 'get-ready', label: `Get ${name} ready`},
    {step: 'sign-in-page', label: `Sign in on ${name}’s page`},
    ...(card.pasting
      ? [{step: 'paste-code' as const, label: 'Paste the code'}]
      : []),
    {step: 'check-plan', label: 'Check your plan'},
  ]

  const current = steps.findIndex(item => item.step === step.step)

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {steps.map((item, index) => (
          <li
            key={item.step}
            aria-current={index === current ? 'step' : undefined}
            className="flex flex-col gap-1.5"
          >
            <span
              className={`flex items-center gap-2 text-sm ${index === current ? 'font-medium' : 'text-muted-foreground'}`}
            >
              <span
                aria-hidden
                className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
                  index < current
                    ? 'bg-success text-primary-foreground'
                    : index === current
                      ? 'animate-pulse bg-primary text-primary-foreground'
                      : 'bg-muted'
                }`}
              >
                {index < current ? '✓' : ''}
              </span>
              {item.label}
            </span>
            {index === current && (
              <StepDetail
                provider={provider}
                step={step}
                openPage={openPage}
                submitCode={submitCode}
              />
            )}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted-foreground">
        {STATUS_LINES[step.step](PROVIDER_NAMES[provider], step)}
      </p>
    </div>
  )
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1_000_000)
}

function StepDetail({
  provider,
  step,
  openPage,
  submitCode,
}: {
  provider: ProviderId
  step: SignInStep
  openPage: () => void
  submitCode: (code: string) => void
}) {
  const name = PROVIDER_NAMES[provider]

  if (step.step === 'get-ready' && step.progress) {
    const {receivedBytes, totalBytes} = step.progress

    return (
      <div
        role="progressbar"
        aria-label={`Getting ${name} ready`}
        aria-valuemin={0}
        aria-valuemax={totalBytes}
        aria-valuenow={receivedBytes}
        className="ml-7 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{
            width: `${totalBytes ? (receivedBytes / totalBytes) * 100 : 0}%`,
          }}
        />
      </div>
    )
  }

  if (step.step === 'sign-in-page') {
    return (
      <div className="ml-7 flex flex-col items-start gap-1">
        <span className="text-xs text-muted-foreground">
          {name}’s page may say “{ABOUT[provider].program}”. That’s normal.
        </span>
        <OpenAgain openPage={openPage} />
      </div>
    )
  }

  if (step.step === 'paste-code') {
    return (
      <div className="ml-7 flex flex-col gap-2">
        <CodeEntry
          provider={provider}
          wrongCode={step.wrongCode === true}
          submitCode={submitCode}
        />
        {step.url && (
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {name}’s page
            <input
              readOnly
              value={step.url}
              onFocus={event => event.target.select()}
              className="truncate rounded-md border border-input bg-background px-2 py-1"
            />
          </label>
        )}
        <OpenAgain openPage={openPage} />
      </div>
    )
  }

  return null
}

function OpenAgain({openPage}: {openPage: () => void}) {
  return (
    <button
      type="button"
      className="text-xs text-muted-foreground underline"
      onClick={openPage}
    >
      Don’t see the page? Open it again
    </button>
  )
}

function CodeEntry({
  provider,
  wrongCode,
  submitCode,
}: {
  provider: ProviderId
  wrongCode: boolean
  submitCode: (code: string) => void
}) {
  const [code, setCode] = useState('')

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={event => {
        event.preventDefault()

        if (code.trim() !== '') submitCode(code)
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="Code"
          aria-invalid={wrongCode}
          autoFocus
          placeholder="Paste the code here"
          value={code}
          onChange={event => setCode(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm aria-invalid:border-destructive"
        />
        <Button type="submit" size="sm" disabled={code.trim() === ''}>
          Connect
        </Button>
      </div>
      {wrongCode && (
        <p className="text-xs text-destructive">
          That code didn’t work. Copy it again from {PROVIDER_NAMES[provider]}’s
          page.
        </p>
      )}
    </form>
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
        : card.failure.reason === 'free-plan'
          ? 'Use a different account'
          : 'Try again'}
    </Button>
  )
}

const STATUS_LINES: Record<Step, (name: string, step: SignInStep) => string> = {
  'get-ready': (name, {progress}) =>
    progress
      ? `Getting ${name} ready… ${megabytes(progress.receivedBytes)} of ${megabytes(progress.totalBytes)} MB`
      : `Getting ${name} ready…`,
  'sign-in-page': name =>
    `Finish signing in on ${name}’s page in your browser.`,
  'paste-code': name =>
    `${name}’s page shows a code. Copy it and paste it here.`,
  'check-plan': () => 'Checking your plan…',
}

const FAILURE_LINES: Record<
  SignInFailure['reason'],
  (provider: ProviderId, failure: SignInFailure) => string
> = {
  'download-failed': provider =>
    `Couldn’t get ${PROVIDER_NAMES[provider]} ready. Check your internet connection and try again.`,
  'no-answer': provider =>
    `Sign-in didn’t finish on ${PROVIDER_NAMES[provider]}’s page. Try again.`,
  'free-plan': provider =>
    `Unimatrix Zero needs ${PROVIDER_NAMES[provider]} ${ABOUT[provider].plans}.`,
  failed: (_provider, failure) => failure.message,
}
