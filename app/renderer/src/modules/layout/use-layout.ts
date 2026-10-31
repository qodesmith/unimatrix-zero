import type {LayoutStore} from './layout-store'
import type {Layout, LayoutUpdate} from '@uz/contract/layout'

import {bridge} from '#modules/bridge/main'
import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const LayoutStoreContext = createContext<LayoutStore | null>(null)

function useLayoutStore() {
  const store = use(LayoutStoreContext)

  if (!store) throw new Error('useLayout needs <LayoutProvider> above it')

  return store
}

/** How the window is arranged, as main last reported it. */
export function useLayout(): Layout {
  return useSelector(useLayoutStore(), state => state)
}

/**
 * Shows the change at once; main's answer, or its refusal, settles what every
 * window shows.
 */
export function useUpdateLayout() {
  const store = useLayoutStore()

  return async (changes: LayoutUpdate) => {
    const before = store.state
    store.setState(current => ({...current, ...changes}))

    const outcome = await bridge().send({type: 'layout.update', changes})

    store.setState(() => (outcome.ok ? outcome.value : before))
  }
}
