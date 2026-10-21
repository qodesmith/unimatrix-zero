import type {Tree} from '@uz/contract/trees'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {applyEvent} from './apply-event'

/**
 * The Trees list: `tree.list` once, then live events. Main answers and sends
 * on one ordered channel, so events folded in before the list arrives are
 * already part of it.
 */
export function useTrees() {
  const [trees, setTrees] = useState<Tree[]>([])
  const [openTreeId, setOpenTreeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = bridge().subscribe(event => {
      setTrees(current => applyEvent(current, event))
    })

    async function load() {
      const outcome = await bridge().send({type: 'tree.list'})

      if (outcome.ok) setTrees(outcome.value.trees)
      else setError(outcome.error.message)
    }

    void load()

    return unsubscribe
  }, [])

  async function open(treeId: string) {
    const outcome = await bridge().send({type: 'tree.open', treeId})

    if (outcome.ok) setOpenTreeId(outcome.value.id)
    else setError(outcome.error.message)
  }

  async function create() {
    const outcome = await bridge().send({type: 'tree.create'})

    if (outcome.ok) setOpenTreeId(outcome.value.id)
    else setError(outcome.error.message)
  }

  async function rename(treeId: string, title: string) {
    const outcome = await bridge().send({type: 'tree.rename', treeId, title})

    if (!outcome.ok) setError(outcome.error.message)
  }

  return {
    trees,
    openTree: trees.find(tree => tree.id === openTreeId) ?? null,
    error,
    open,
    create,
    rename,
  }
}
