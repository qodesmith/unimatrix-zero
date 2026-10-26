import type {SettingsStore} from './settings-store'
import type {Settings, SettingsUpdate} from '@uz/contract/settings'

import {bridge} from '#modules/bridge/main'
import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const SettingsStoreContext = createContext<SettingsStore | null>(null)

function useSettingsStore() {
  const store = use(SettingsStoreContext)

  if (!store) throw new Error('useSettings needs <SettingsProvider> above it')

  return store
}

/** The user's global Settings, as main last reported them. */
export function useSettings(): Settings {
  return useSelector(useSettingsStore(), state => state)
}

/**
 * Shows the change at once; main's answer, or its refusal, settles what every
 * window shows.
 */
export function useUpdateSettings() {
  const store = useSettingsStore()

  return async (changes: SettingsUpdate) => {
    const before = store.state
    store.setState(current => ({...current, ...changes}))

    const outcome = await bridge().send({type: 'settings.update', changes})

    store.setState(() => (outcome.ok ? outcome.value : before))
  }
}
