import type {Layout, Size} from './layout'
import type {TreeIndex} from './tree'
import type {Viewport} from '@xyflow/react'

import {useReactFlow, useStore} from '@xyflow/react'
import {useCallback, useLayoutEffect, useRef} from 'react'

/** The room kept between a followed Reply's box and the canvas's edge, in px. */
const MARGIN = 24

interface Span {
  start: number
  end: number
}

/**
 * How far to shift a span to bring it inside `length`; its end wins when it
 * does not fit.
 */
function shiftInto({start, end}: Span, length: number) {
  const last = length - MARGIN

  if (end > last) return last - end

  if (start < MARGIN) return Math.min(MARGIN - start, last - end)

  return 0
}

interface Followed {
  replyId: string
  /** False while the user has panned its bottom off the canvas. */
  pinned: boolean
}

interface FollowOptions {
  index: TreeIndex
  layout: Layout
  measured: Record<string, Size>
  nodeIdOf: (replyId: string) => string
  panMs: number
}

/**
 * Keeps a streaming Reply's bottom, its Input included, on the canvas while it
 * grows. Panning that bottom away lets the Reply go; panning back follows it
 * again.
 */
export function useFollow({
  index,
  layout,
  measured,
  nodeIdOf,
  panMs,
}: FollowOptions) {
  const flow = useReactFlow()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  const followed = useRef<Followed | null>(null)
  // A move during a glide aims it again rather than cutting it short.
  const glide = useRef(0)
  const glides = useRef(0)

  const boxOf = useCallback(
    (replyId: string) => {
      const nodeId = nodeIdOf(replyId)
      const node = layout.nodes.find(candidate => candidate.id === nodeId)
      const size = measured[nodeId]

      if (!node || !size) return null

      const {x, y, zoom} = flow.getViewport()
      const left = node.position.x * zoom + x
      const top = node.position.y * zoom + y

      return {
        x: {start: left, end: left + size.width * zoom},
        y: {start: top, end: top + size.height * zoom},
      }
    },
    [nodeIdOf, layout, measured, flow]
  )

  const glideTo = useCallback(
    async (target: Viewport) => {
      const sequence = ++glides.current
      glide.current = sequence
      await flow.setViewport(target, {duration: panMs})

      if (glide.current === sequence) glide.current = 0
    },
    [flow, panMs]
  )

  const reveal = useCallback(
    (replyId: string, gliding: boolean) => {
      const box = boxOf(replyId)

      if (!box) return

      const dx = shiftInto(box.x, width)
      const dy = shiftInto(box.y, height)

      if (dx === 0 && dy === 0) return

      const {x, y, zoom} = flow.getViewport()
      const target = {x: x + dx, y: y + dy, zoom}

      void (gliding ? glideTo(target) : flow.setViewport(target))
    },
    [boxOf, width, height, flow, glideTo]
  )

  useLayoutEffect(() => {
    const {current} = followed

    if (!current) return

    if (current.pinned) reveal(current.replyId, glide.current !== 0)

    if (index.replyById.get(current.replyId)?.status !== 'streaming') {
      followed.current = null
    }
  }, [reveal, index])

  /** Glides a measured Reply's box onto the canvas and follows it from there. */
  const follow = useCallback(
    (replyId: string) => {
      followed.current = {replyId, pinned: true}
      reveal(replyId, true)
    },
    [reveal]
  )

  const unfollow = useCallback(() => {
    followed.current = null
  }, [])

  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (!event) return

    glide.current = 0

    if (followed.current)
      followed.current = {...followed.current, pinned: false}
  }, [])

  const onMoveEnd = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      const {current} = followed

      if (!event || !current) return

      const box = boxOf(current.replyId)

      const pinned =
        box !== null &&
        box.y.end >= 0 &&
        box.y.end <= height &&
        box.x.end > 0 &&
        box.x.start < width

      followed.current = {...current, pinned}
    },
    [boxOf, width, height]
  )

  return {follow, unfollow, onMoveStart, onMoveEnd}
}
