import type {Command} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'
import {useState} from 'react'

/** Sends one command, keeping main's refusal to show beside its button. */
export function useCommand() {
  const [error, setError] = useState<string | null>(null)

  async function run(command: Command) {
    const outcome = await bridge().send(command)

    setError(outcome.ok ? null : outcome.error.message)

    return outcome.ok
  }

  return {error, run}
}
