import type {ModelPick} from '../pick-model'
import type {ModelChoice} from '@uz/contract/providers'

import {ProviderMark, useConnections} from '#modules/connections/main'
import {InputGroupButton} from '#shadcn/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '#shadcn/ui/select'
import {PROVIDER_NAMES} from '@uz/contract/providers'

function sameChoice(a: ModelChoice, b: ModelChoice) {
  return a.provider === b.provider && a.model === b.model
}

interface ModelPickerProps {
  pick: ModelPick
  onPick: (choice: ModelChoice) => void
}

export function ModelPicker({pick, onPick}: ModelPickerProps) {
  const {connect} = useConnections()
  const {selected, groups, signInAgain} = pick

  return (
    <>
      {signInAgain && (
        <InputGroupButton
          variant="outline"
          onClick={() => void connect(signInAgain)}
        >
          Sign in again
        </InputGroupButton>
      )}
      <Select<ModelChoice>
        value={selected && {provider: selected.provider, model: selected.model}}
        isItemEqualToValue={sameChoice}
        onValueChange={choice => {
          if (choice) onPick(choice)
        }}
      >
        <SelectTrigger
          aria-label="Model"
          className="h-6 max-w-48 gap-1 border-transparent bg-transparent px-1.5 shadow-none hover:bg-muted aria-expanded:bg-muted dark:bg-transparent dark:hover:bg-muted/50"
        >
          <SelectValue>
            {selected ? (
              <>
                <ProviderMark provider={selected.provider} />
                <span className="truncate">{selected.name}</span>
              </>
            ) : (
              'No Model'
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-48">
          {groups.map(({provider, models}) => (
            <SelectGroup key={provider}>
              <SelectLabel className="flex items-center gap-1.5">
                <ProviderMark provider={provider} />
                {PROVIDER_NAMES[provider]}
              </SelectLabel>
              {models.map(model => (
                <SelectItem
                  key={model.id}
                  value={{provider, model: model.id}}
                  disabled={model.needsAppUpdate}
                >
                  {model.name}
                  {model.needsAppUpdate && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Needs an app update
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
