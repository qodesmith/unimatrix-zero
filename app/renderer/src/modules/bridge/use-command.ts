import type {Command} from '@uz/contract/commands'

import {useState} from 'react'

import {bridge} from './bridge'

export function useCommand() {
  const [error, setError] = useState<string | null>(null)

  async function run(command: Command) {
    const outcome = await bridge().send(command)

    setError(outcome.ok ? null : outcome.error.message)

    return outcome.ok
  }

  return {error, run}
}
