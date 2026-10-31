import type {ReactNode} from 'react'

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
    <fieldset className="flex flex-col gap-2">
      <legend id={legendId} className="mb-2 text-sm font-medium">
        {legend}
      </legend>
      {children}
    </fieldset>
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

  return (
    <Group legend={legend} legendId={legendId}>
      <RadioGroup
        aria-labelledby={legendId}
        className="gap-2"
        value={value}
        onValueChange={onChange}
      >
        {options.map(option => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={option.value} />
            {option.label}
          </label>
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
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch className="mt-0.5" checked={checked} onCheckedChange={onChange} />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}
