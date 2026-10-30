import type {ReactNode} from 'react'

import {Button, cn} from '#modules/shadcn/main'
import {useReactFlow, useStoreApi} from '@xyflow/react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'

import {atBottom} from '../at-bottom'

interface CappedTextProps {
  /** Off: the text takes its full height and there is nothing to show more of. */
  limit: boolean
  maxHeightClass: string
  expanded: boolean
  onToggle: () => void
  /** The box stays on the newest text until the user scrolls up. */
  streaming?: boolean
  className?: string
  children: ReactNode
}

/** The box's scroll on either side of a toggle, in canvas units. */
interface Toggle {
  from: number
  to: number
}

/**
 * `nowheel` makes the wheel scroll capped text instead of panning the canvas.
 * Show more and Show less keep the text being read where it is on screen:
 * capping scrolls the box to the text at the canvas's top edge, and the canvas
 * moves by however far the box's scroll changed.
 */
export function CappedText({
  limit,
  maxHeightClass,
  expanded,
  onToggle,
  streaming = false,
  className,
  children,
}: CappedTextProps) {
  const [overflows, setOverflows] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const toggle = useRef<Toggle | null>(null)
  const flow = useReactFlow()
  const store = useStoreApi()
  const capped = limit && !expanded

  // On every render, since a toggle is waiting only for the one it causes.
  useLayoutEffect(() => {
    const outer = box.current
    const {current} = toggle

    if (!outer || !current) return

    toggle.current = null
    outer.scrollTop = current.to

    const {x, y, zoom} = flow.getViewport()
    const moved = outer.scrollTop - current.from

    if (moved !== 0) void flow.setViewport({x, y: y + moved * zoom, zoom})
  })

  function onClick() {
    const outer = box.current

    if (!outer) return

    const pane = store.getState().domNode?.getBoundingClientRect().top ?? 0
    const above = (pane - outer.getBoundingClientRect().top) / flow.getZoom()

    toggle.current = expanded
      ? {from: 0, to: Math.max(0, above)}
      : {from: outer.scrollTop, to: 0}
    onToggle()
  }

  useEffect(() => {
    const outer = box.current
    const inner = content.current

    if (!outer || !inner) return undefined

    const observer = new ResizeObserver(() => {
      setOverflows(outer.scrollHeight > outer.clientHeight + 1)

      if (streaming && pinned.current) outer.scrollTop = outer.scrollHeight
    })

    observer.observe(outer)
    observer.observe(inner)

    return () => observer.disconnect()
  }, [streaming])

  return (
    <div className={className}>
      <div
        ref={box}
        onScroll={event => {
          pinned.current = atBottom(event.currentTarget)
        }}
        className={cn(capped && ['nowheel overflow-y-auto', maxHeightClass])}
      >
        <div ref={content}>{children}</div>
      </div>
      {limit && (overflows || expanded) && (
        <div className="mt-1 flex justify-end">
          <Button
            variant="link"
            className="h-auto border-0 p-0 text-xs font-normal underline-offset-auto"
            onClick={onClick}
          >
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        </div>
      )}
    </div>
  )
}
