import type {Command} from '@uz/contract/commands'
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

  /** Sends a command, shows its error if it fails, and returns its value. */
  async function run<C extends Command>(command: C) {
    const outcome = await bridge().send(command)
    setError(outcome.ok ? null : outcome.error.message)

    return outcome.ok ? outcome.value : null
  }

  async function open(treeId: string) {
    const tree = await run({type: 'tree.open', treeId})

    if (tree) setOpenTreeId(tree.id)
  }

  async function create() {
    const tree = await run({type: 'tree.create'})

    if (tree) setOpenTreeId(tree.id)
  }

  async function rename(treeId: string, title: string) {
    await run({type: 'tree.rename', treeId, title})
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
