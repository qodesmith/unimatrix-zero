import type {Command} from '@uz/contract/commands'
import type {Tree} from '@uz/contract/trees'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {applyEvent, sortTrees} from './apply-event'

/**
 * Main answers and sends on one ordered channel, so earlier events are already
 * in the `tree.list` answer.
 */
export function useTrees() {
  const [trees, setTrees] = useState<Tree[]>([])
  const [listed, setListed] = useState(false)
  const [openTreeId, setOpenTreeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = bridge().subscribe(event => {
      setTrees(current => applyEvent(current, event))
    })

    async function load() {
      const outcome = await bridge().send({type: 'tree.list'})

      if (outcome.ok) {
        setTrees(sortTrees(outcome.value.trees))
        setListed(true)
      } else {
        setError(outcome.error.message)
      }
    }

    void load()

    return unsubscribe
  }, [])

  const openTree = trees.find(tree => tree.id === openTreeId) ?? null
  const failureInOpenTree = openTree?.unseenFailure === true

  useEffect(() => {
    if (openTreeId !== null && failureInOpenTree) {
      void bridge().send({type: 'tree.open', treeId: openTreeId})
    }
  }, [openTreeId, failureInOpenTree])

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
    hasTrees: trees.length > 0 ? true : listed ? false : null,
    openTree,
    error,
    open,
    create,
    rename,
  }
}
