import type {Card} from '../cards'
import type {ProviderId, SignInStep} from '@uz/contract/providers'
import type {ReactNode} from 'react'

import {Button} from '#shadcn/ui/button'
import {Field, FieldError, FieldLabel} from '#shadcn/ui/field'
import {Input} from '#shadcn/ui/input'
import {Progress} from '#shadcn/ui/progress'
import {PROVIDER_NAMES, SignInStepEvent} from '@uz/contract/providers'
import {cn} from 'cn'
import {CheckIcon} from 'lucide-react'
import {useId, useState} from 'react'

import {ABOUT} from '../about'

type Step = SignInStep['step']

/** A connecting card's steps, the one under way open. */
export function Checklist({
  provider,
  card,
  openPage,
  submitCode,
}: {
  provider: ProviderId
  card: Extract<Card, {kind: 'connecting'}>
  openPage: () => void
  submitCode: (code: string) => void
}) {
  const name = PROVIDER_NAMES[provider]
  const {step} = card

  const steps = SignInStepEvent.shape.step.options.filter(
    item => item !== 'paste-code' || card.pasting
  )

  const current = steps.indexOf(step.step)

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {steps.map((item, index) => {
          const {label, Detail} = STEPS[item]

          return (
            <li
              key={item}
              aria-current={index === current ? 'step' : undefined}
              className="flex flex-col gap-1.5"
            >
              <span
                className={cn(
                  'flex items-center gap-2 text-sm',
                  index === current ? 'font-medium' : 'text-muted-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full',
                    index < current && 'bg-success text-primary-foreground',
                    index === current &&
                      'animate-pulse bg-primary text-primary-foreground',
                    index > current && 'bg-muted'
                  )}
                >
                  {index < current && <CheckIcon className="size-3" />}
                </span>
                {label(name)}
              </span>
              {index === current && Detail && (
                <Detail
                  provider={provider}
                  step={step}
                  openPage={openPage}
                  submitCode={submitCode}
                />
              )}
            </li>
          )
        })}
      </ol>
      <p className="text-sm text-muted-foreground">
        {STEPS[step.step].status(name, step)}
      </p>
    </div>
  )
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1_000_000)
}

interface StepDetailProps {
  provider: ProviderId
  step: SignInStep
  openPage: () => void
  submitCode: (code: string) => void
}

function DownloadProgress({provider, step}: StepDetailProps) {
  if (!step.progress) return null

  const {receivedBytes, totalBytes} = step.progress

  return (
    <Progress
      aria-label={`Getting ${PROVIDER_NAMES[provider]} ready`}
      value={receivedBytes}
      max={totalBytes}
      className="ml-7"
    />
  )
}

function PageNote({provider, step, openPage}: StepDetailProps) {
  return (
    <div className="ml-7 flex flex-col items-start gap-1">
      <span className="text-xs text-muted-foreground">
        {PROVIDER_NAMES[provider]}’s page may say “{ABOUT[provider].program}”.
        That’s normal.
      </span>
      <OpenAgain url={step.url} openPage={openPage} />
    </div>
  )
}

/** Without a link while a new page replaces one whose code was refused. */
function PasteCode({provider, step, openPage, submitCode}: StepDetailProps) {
  const urlId = useId()

  return (
    <div className="ml-7 flex flex-col gap-2">
      <CodeEntry
        provider={provider}
        wrongCode={step.wrongCode === true}
        disabled={!step.url}
        submitCode={submitCode}
      />
      {step.url && (
        <Field className="gap-0.5">
          <FieldLabel
            htmlFor={urlId}
            className="text-xs font-normal text-muted-foreground"
          >
            {PROVIDER_NAMES[provider]}’s page
          </FieldLabel>
          <Input
            id={urlId}
            readOnly
            value={step.url}
            onFocus={event => event.target.select()}
            className="h-7 truncate px-2 text-xs md:text-xs"
          />
        </Field>
      )}
      <OpenAgain url={step.url} openPage={openPage} />
    </div>
  )
}

function OpenAgain({
  url,
  openPage,
}: {
  url: string | undefined
  openPage: () => void
}) {
  if (!url) return null

  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto px-0 text-muted-foreground underline"
      onClick={openPage}
    >
      Don’t see the page? Open it again
    </Button>
  )
}

function CodeEntry({
  provider,
  wrongCode,
  disabled,
  submitCode,
}: {
  provider: ProviderId
  wrongCode: boolean
  disabled: boolean
  submitCode: (code: string) => void
}) {
  const [code, setCode] = useState('')

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={event => {
        event.preventDefault()

        if (!disabled && code.trim() !== '') submitCode(code)
      }}
    >
      <div className="flex gap-2">
        <Input
          aria-label="Code"
          aria-invalid={wrongCode}
          autoFocus
          placeholder="Paste the code here"
          value={code}
          onChange={event => setCode(event.target.value)}
          className="h-8 flex-1 font-mono"
        />
        <Button
          type="submit"
          size="sm"
          disabled={disabled || code.trim() === ''}
        >
          Connect
        </Button>
      </div>
      {wrongCode && (
        <FieldError className="text-xs">
          That code didn’t work. Copy it again from {PROVIDER_NAMES[provider]}’s
          page.
        </FieldError>
      )}
    </form>
  )
}

const STEPS: Record<
  Step,
  {
    label: (name: string) => string
    status: (name: string, step: SignInStep) => string
    Detail?: (props: StepDetailProps) => ReactNode
  }
> = {
  'get-ready': {
    label: name => `Get ${name} ready`,
    status: (name, {progress}) =>
      progress
        ? `Getting ${name} ready… ${megabytes(progress.receivedBytes)} of ${megabytes(progress.totalBytes)} MB`
        : `Getting ${name} ready…`,
    Detail: DownloadProgress,
  },
  'sign-in-page': {
    label: name => `Sign in on ${name}’s page`,
    status: name => `Finish signing in on ${name}’s page in your browser.`,
    Detail: PageNote,
  },
  'paste-code': {
    label: () => 'Paste the code',
    status: name => `${name}’s page shows a code. Copy it and paste it here.`,
    Detail: PasteCode,
  },
  'check-plan': {
    label: () => 'Check your plan',
    status: () => 'Checking your plan…',
  },
}
