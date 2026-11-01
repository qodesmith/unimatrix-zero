import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {applyLayoutEvent, createLayoutStore} from '../layout-store'
import {LayoutStoreContext} from '../use-layout'

/** Keeps the Layout in step with main for everything inside it. */
export function LayoutProvider({children}: {children: ReactNode}) {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createLayoutStore)

  useEffect(
    () => bridge().subscribe(event => applyLayoutEvent(store, event)),
    [store]
  )

  return <LayoutStoreContext value={store}>{children}</LayoutStoreContext>
}
