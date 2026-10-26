import type {ReactNode} from 'react'

import {cn} from '#modules/shadcn/main'
import {useEffect, useRef, useState} from 'react'

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

/** How close to the bottom still counts as reading the newest text, in px. */
const AT_BOTTOM = 24

/** `nowheel` makes the wheel scroll capped text instead of panning the canvas. */
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
  const capped = limit && !expanded

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
          const {scrollHeight, scrollTop, clientHeight} = event.currentTarget
          pinned.current = scrollHeight - scrollTop - clientHeight < AT_BOTTOM
        }}
        className={cn(capped && `nowheel overflow-y-auto ${maxHeightClass}`)}
      >
        <div ref={content}>{children}</div>
      </div>
      {limit && (overflows || expanded) && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={onToggle}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  )
}
