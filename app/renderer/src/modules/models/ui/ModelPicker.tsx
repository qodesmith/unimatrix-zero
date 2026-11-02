import type {ModelPick} from '../pick-model'
import type {ModelChoice} from '@uz/contract/providers'

import {ProviderMark, useConnections} from '#modules/connections/main'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#shadcn/ui/dropdown-menu'
import {InputGroupButton} from '#shadcn/ui/input-group'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {ChevronDownIcon} from 'lucide-react'

function keyOf({provider, model}: ModelChoice) {
  return JSON.stringify([provider, model])
}

interface ModelPickerProps {
  pick: ModelPick
  onPick: (choice: ModelChoice) => void
}

/** The Input's Model: a trigger with the Provider's mark, and "Sign in again". */
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
      <DropdownMenu>
        <DropdownMenuTrigger render={<InputGroupButton className="max-w-48" />}>
          {selected ? (
            <>
              <ProviderMark provider={selected.provider} />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span>No Model</span>
          )}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuRadioGroup value={selected ? keyOf(selected) : ''}>
            {groups.map(({provider, models}) => (
              <DropdownMenuGroup key={provider}>
                <DropdownMenuLabel className="flex items-center gap-1.5">
                  <ProviderMark provider={provider} />
                  {PROVIDER_NAMES[provider]}
                </DropdownMenuLabel>
                {models.map(model => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={keyOf({provider, model: model.id})}
                    disabled={model.needsAppUpdate}
                    onClick={() => onPick({provider, model: model.id})}
                  >
                    {model.name}
                    {model.needsAppUpdate && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Needs an app update
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
