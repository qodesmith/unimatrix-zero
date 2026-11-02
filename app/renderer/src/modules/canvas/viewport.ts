import type {ReactFlowInstance} from '@xyflow/react'

import {useReactFlow} from '@xyflow/react'
import {useCallback, useMemo, useRef, useState} from 'react'

import {useCanvas} from './canvas-context'

/**
 * The viewport moves the canvas makes itself. Each move cuts short the one
 * before it, and React Flow never resolves a glide cut short, so only the
 * latest glide can end the motion.
 */
export function useMotion() {
  const latest = useRef(0)
  const [moving, setMoving] = useState(false)

  const glide = useCallback(async (run: () => Promise<boolean>) => {
    const sequence = ++latest.current
    setMoving(true)
    const moved = await run()

    if (latest.current === sequence) setMoving(false)

    return moved
  }, [])

  /** The glide in flight was ended by a move with no duration, or by the user. */
  const stop = useCallback(() => {
    latest.current += 1
    setMoving(false)
  }, [])

  const jump = useCallback(
    async (run: () => Promise<boolean>) => {
      stop()

      return run()
    },
    [stop]
  )

  // Apart from `moving`: effects depend on these and must not rerun as it changes.
  const moves = useMemo(() => ({glide, jump, stop}), [glide, jump, stop])

  return {moving, moves}
}

export type Moves = ReturnType<typeof useMotion>['moves']

type CanvasViewport = ReactFlowInstance & {stop: Moves['stop']}

function viewportOf(flow: ReactFlowInstance, moves: Moves): CanvasViewport {
  async function move(
    duration: number | undefined,
    run: () => Promise<boolean>
  ) {
    return duration ? moves.glide(run) : moves.jump(run)
  }

  return {
    ...flow,
    setViewport: async (viewport, options) =>
      move(options?.duration, async () => flow.setViewport(viewport, options)),
    setCenter: async (x, y, options) =>
      move(options?.duration, async () => flow.setCenter(x, y, options)),
    fitView: async options =>
      move(options?.duration, async () => flow.fitView(options)),
    fitBounds: async (bounds, options) =>
      move(options?.duration, async () => flow.fitBounds(bounds, options)),
    zoomIn: async options =>
      move(options?.duration, async () => flow.zoomIn(options)),
    zoomOut: async options =>
      move(options?.duration, async () => flow.zoomOut(options)),
    zoomTo: async (zoomLevel, options) =>
      move(options?.duration, async () => flow.zoomTo(zoomLevel, options)),
    stop: moves.stop,
  }
}

/**
 * React Flow's instance, with each of its seven viewport moves counted in the
 * canvas's `moving`. A move with a duration resolves once it ends, and never
 * when cut short.
 */
export function useViewport() {
  const flow = useReactFlow()
  const {moves} = useCanvas()

  return useMemo(() => viewportOf(flow, moves), [flow, moves])
}
