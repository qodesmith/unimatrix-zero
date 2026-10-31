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

interface ChoiceProps<T extends string> {
  legend: string
  value: T
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
}

export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: ChoiceProps<T>) {
  const legendId = useId()
  const optionId = useId()

  return (
    <Group legend={legend} legendId={legendId}>
      <RadioGroup
        aria-labelledby={legendId}
        className="gap-2"
        value={value}
        onValueChange={onChange}
      >
        {options.map(option => (
          <Field key={option.value} orientation="horizontal">
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
    </Group>
  )
}

interface ToggleProps {
  label: string
  description: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Toggle({label, description, checked, onChange}: ToggleProps) {
  const id = useId()

  return (
    <Field orientation="horizontal" className="gap-3">
      <Switch
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onChange}
      />
      <FieldContent className="gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
