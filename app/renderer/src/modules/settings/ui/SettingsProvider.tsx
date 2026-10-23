import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {applySettingsEvent, createSettingsStore} from '../settings-store'
import {SettingsStoreContext} from '../use-settings'

/** Keeps the Settings in step with main for everything inside it. */
export function SettingsProvider({children}: {children: ReactNode}) {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createSettingsStore)

  useEffect(
    () => bridge().subscribe(event => applySettingsEvent(store, event)),
    [store]
  )

  return <SettingsStoreContext value={store}>{children}</SettingsStoreContext>
}
