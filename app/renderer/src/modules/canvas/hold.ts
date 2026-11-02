import type {Collapsed, Expanded} from './canvas-context'
import type {CanvasLayout, Size} from './canvas-layout'
import type {Moves} from './motion'

import {useReactFlow} from '@xyflow/react'
import {useCallback, useLayoutEffect, useRef} from 'react'

interface Held {
  turnId: string
  /**
   * Its box's size before its text was let out or capped, held until it
   * changes.
   */
  resizing: Size | null
}

function settledSize(held: Held, size: Size | undefined) {
  return held.resizing === null || size !== held.resizing
}

export interface Deleted {
  parentReplyId: string | null
  /** Its box changes size once it is measured again. */
  resizes: boolean
}

interface HoldOptions {
  canvasLayout: CanvasLayout
  collapsed: Collapsed
  expanded: Expanded
  deleted: Deleted | null
  measured: Record<string, Size>
  allMeasured: boolean
  nodeIdOf: (turnId: string) => string
  letGo: () => void
  moves: Moves
}

/**
 * Keeps a Turn still on screen while the canvas layout moves it; returns what
 * lets it go.
 */
export function useHold({
  canvasLayout,
  collapsed,
  expanded,
  deleted,
  measured,
  allMeasured,
  nodeIdOf,
  letGo,
  moves,
}: HoldOptions) {
  const flow = useReactFlow()
  const lastCanvasLayout = useRef(canvasLayout)
  const lastCollapsed = useRef(collapsed)
  const lastExpanded = useRef(expanded)
  const lastDeleted = useRef(deleted)
  const held = useRef<Held | null>(null)

  // Declared before the effect that moves the viewport for the held Turn, so it
  // runs first in the render the Turns go.
  useLayoutEffect(() => {
    if (lastDeleted.current === deleted) return

    lastDeleted.current = deleted
    const turnId = deleted?.parentReplyId ?? null

    if (deleted === null || turnId === null) return

    held.current = {
      turnId,
      resizing: deleted.resizes ? (measured[nodeIdOf(turnId)] ?? null) : null,
    }
  }, [deleted, measured, nodeIdOf])

  useLayoutEffect(() => {
    const before = lastCanvasLayout.current
    lastCanvasLayout.current = canvasLayout

    if (lastCollapsed.current !== collapsed) {
      lastCollapsed.current = collapsed
      const turnId = collapsed.toggledReplyId
      held.current = turnId === null ? null : {turnId, resizing: null}
    }

    if (lastExpanded.current !== expanded) {
      lastExpanded.current = expanded
      const turnId = expanded.toggledTurnId

      held.current =
        turnId === null
          ? null
          : {turnId, resizing: measured[nodeIdOf(turnId)] ?? null}

      if (turnId !== null) letGo()
    }

    const {current} = held

    if (current === null) return

    const nodeId = nodeIdOf(current.turnId)

    if (allMeasured && settledSize(current, measured[nodeId]))
      held.current = null

    const from = before.nodes.find(node => node.id === nodeId)?.position
    const to = canvasLayout.nodes.find(node => node.id === nodeId)?.position

    if (!from || !to) return

    const {x, y, zoom} = flow.getViewport()

    moves.jump(async () =>
      flow.setViewport({
        x: x - (to.x - from.x) * zoom,
        y: y - (to.y - from.y) * zoom,
        zoom,
      })
    )
  }, [
    canvasLayout,
    collapsed,
    expanded,
    measured,
    allMeasured,
    nodeIdOf,
    flow,
    letGo,
    moves,
  ])

  return useCallback(() => {
    held.current = null
  }, [])
}
