import type {ReactNode} from 'react'

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#shadcn/ui/field'
import {RadioGroup, RadioGroupItem} from '#shadcn/ui/radio-group'
import {Switch} from '#shadcn/ui/switch'
import {cn} from 'cn'
import {useId} from 'react'

interface GroupProps {
  legend: string
  legendId?: string
  children: ReactNode
}

export function Group({legend, legendId, children}: GroupProps) {
  return (
    <FieldSet className="gap-2">
      <FieldLegend id={legendId} variant="label" className="mb-2">
        {legend}
      </FieldLegend>
      {children}
    </FieldSet>
  )
}

interface ChoiceProps<T extends number | string> extends Omit<
  ChoiceOptionsProps<T>,
  'legendId' | 'inline'
> {
  legend: string
}

export function Choice<T extends number | string>({
  legend,
  ...choice
}: ChoiceProps<T>) {
  const legendId = useId()

  return (
    <Group legend={legend} legendId={legendId}>
      <ChoiceOptions legendId={legendId} {...choice} />
    </Group>
  )
}

interface ChoiceOptionsProps<T extends number | string> {
  legendId: string
  value: T
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
  inline?: boolean
}

/** A Choice's radios without its legend, for a Group that holds more. */
export function ChoiceOptions<T extends number | string>({
  legendId,
  value,
  options,
  onChange,
  inline = false,
}: ChoiceOptionsProps<T>) {
  const optionId = useId()

  return (
    <RadioGroup
      aria-labelledby={legendId}
      className={cn('gap-2', inline && 'flex w-auto flex-wrap gap-x-5')}
      value={value}
      onValueChange={onChange}
    >
      {options.map(option => (
        <Field
          key={option.value}
          orientation="horizontal"
          className={cn(inline && 'w-auto gap-2')}
        >
          <RadioGroupItem
            id={`${optionId}-${option.value}`}
            value={option.value}
          />
          <FieldLabel
            htmlFor={`${optionId}-${option.value}`}
            className="font-normal"
          >
            {option.label}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  )
}

interface ToggleProps {
  label: string
  description: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) {
  const id = useId()

  return (
    <Field orientation="horizontal" className="gap-3">
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <FieldContent className="gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
