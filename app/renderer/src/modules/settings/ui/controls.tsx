import type {ReactNode} from 'react'

interface ChoiceProps<T extends string> {
  legend: string
  value: T
  options: readonly {value: T; label: string}[]
  onChange: (value: T) => void
}

/** One of a few values, each spelled out, as radio buttons. */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: ChoiceProps<T>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {options.map(option => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            className="accent-primary"
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
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
      <input
        type="checkbox"
        className="mt-0.5 accent-primary"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}
