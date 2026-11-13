import type {ProviderId} from '@uz/contract/providers'
import type {SettingsUpdate} from '@uz/contract/settings'

import {Field, FieldDescription, FieldLabel} from '#shadcn/ui/field'
import {Input} from '#shadcn/ui/input'
import {Slider} from '#shadcn/ui/slider'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {COMPACTION_THRESHOLD, compactionFor} from '@uz/contract/settings'
import {cn} from 'cn'
import {useId, useState} from 'react'

import {useSettings, useUpdateSettings} from '../use-settings'
import {Group, Toggle} from './Controls'

const STEP = 1000

const APPLIES = 'Applies to every Thread from its next Reply.'

const tokens = new Intl.NumberFormat('en-US')

const thresholdUpdate: Record<
  ProviderId,
  (threshold: number | null) => SettingsUpdate
> = {
  claude: claudeCompactionThreshold => ({claudeCompactionThreshold}),
  chatgpt: chatgptCompactionThreshold => ({chatgptCompactionThreshold}),
}

interface CompactionSettingsProps {
  provider: ProviderId
}

export function CompactionSettings({provider}: CompactionSettingsProps) {
  const update = useUpdateSettings()
  const {auto, threshold} = compactionFor(useSettings(), provider)

  return (
    <Group legend={`${PROVIDER_NAMES[provider]} Compaction`}>
      {provider === 'claude' ? (
        <Toggle
          label="Automatic Compaction"
          description={
            <>
              A Thread that fills the Model’s Context window stops taking
              Prompts.
              <span className="block">{APPLIES}</span>
            </>
          }
          checked={auto}
          onChange={claudeAutoCompaction => void update({claudeAutoCompaction})}
        />
      ) : (
        <Toggle
          disabled
          label="Automatic Compaction"
          description="Codex can’t turn Compaction off."
          checked
          onChange={() => undefined}
        />
      )}
      <Threshold
        range={COMPACTION_THRESHOLD[provider]}
        saved={threshold}
        disabled={!auto}
        onCommit={next => void update(thresholdUpdate[provider](next))}
      />
    </Group>
  )
}

function thumbOf(value: number | readonly number[]) {
  return [value].flat()[0] ?? 0
}

interface ThresholdProps {
  range: {min: number; max: number}
  /** Null is the Provider's default, which the slider's maximum stands for. */
  saved: number | null
  disabled: boolean
  onCommit: (threshold: number | null) => void
}

function Threshold({range, saved, disabled, onCommit}: ThresholdProps) {
  const labelId = useId()
  const inputId = useId()
  const [dragged, setDragged] = useState<number | null>(null)
  const [typed, setTyped] = useState<string | null>(null)

  const shown = dragged ?? saved ?? range.max
  const isDefault = shown === range.max

  function commit(value: number) {
    const clamped = Math.min(range.max, Math.max(range.min, Math.round(value)))
    const threshold = clamped === range.max ? null : clamped

    if (threshold !== saved) onCommit(threshold)
  }

  function commitTyped() {
    if (typed === null) return

    setTyped(null)
    const value = Number(typed.replaceAll(/[\s,]/g, ''))

    if (typed.trim() !== '' && Number.isFinite(value)) commit(value)
  }

  return (
    <Field>
      <FieldLabel id={labelId} htmlFor={inputId}>
        Compact at
      </FieldLabel>
      <div className="flex items-center gap-3">
        <Slider
          aria-labelledby={labelId}
          min={range.min}
          max={range.max}
          step={STEP}
          largeStep={10 * STEP}
          value={[shown]}
          disabled={disabled}
          getAriaValueText={(_, value) =>
            value === range.max ? 'Default' : `${tokens.format(value)} tokens`
          }
          onValueChange={value => setDragged(thumbOf(value))}
          onValueCommitted={value => {
            setDragged(null)
            commit(thumbOf(value))
          }}
        />
        <Input
          id={inputId}
          inputMode="numeric"
          className="w-28 shrink-0 text-right tabular-nums"
          value={typed ?? (isDefault ? 'Default' : tokens.format(shown))}
          disabled={disabled}
          onChange={event => setTyped(event.currentTarget.value)}
          onBlur={commitTyped}
          onKeyDown={event => {
            if (event.key === 'Enter') commitTyped()
          }}
        />
        <span
          className={cn(
            'text-sm text-muted-foreground',
            isDefault && 'invisible'
          )}
        >
          tokens
        </span>
      </div>
      <FieldDescription>
        A Model with a smaller Context window compacts at its own limit.
        <span className="block">{APPLIES}</span>
      </FieldDescription>
    </Field>
  )
}
