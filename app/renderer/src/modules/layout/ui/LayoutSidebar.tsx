import type {CSSProperties, KeyboardEvent, PointerEvent, ReactNode} from 'react'

import {Sidebar, SidebarProvider} from '#shadcn/ui/sidebar'
import {
  DEFAULT_LAYOUT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@uz/contract/layout'
import {cn} from 'cn'
import {useRef, useState} from 'react'

import {useLayout, useUpdateLayout} from '../use-layout'

const KEY_STEP = 10

function clampWidth(width: number) {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
  )
}

interface LayoutSidebarProps {
  /** What the sidebar holds. */
  sidebar: ReactNode
  /** The rest of the window, beside the sidebar. */
  children: ReactNode
}

/**
 * The app sidebar, open or closed and as wide as the Layout says. A drag of
 * its right edge shows each width as it goes and saves only the last.
 */
export function LayoutSidebar({sidebar, children}: LayoutSidebarProps) {
  const layout = useLayout()
  const updateLayout = useUpdateLayout()
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const dragStart = useRef({x: 0, width: 0})
  const width = dragWidth ?? layout.sidebarWidth

  const style: CSSProperties & Record<'--sidebar-width', string> = {
    '--sidebar-width': `${width}px`,
  }

  function save(sidebarWidth: number) {
    if (sidebarWidth !== layout.sidebarWidth) void updateLayout({sidebarWidth})
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = {x: event.clientX, width: layout.sidebarWidth}
    setDragWidth(layout.sidebarWidth)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragWidth === null) return

    const {x, width: from} = dragStart.current
    setDragWidth(clampWidth(from + event.clientX - x))
  }

  function onPointerUp() {
    if (dragWidth === null) return

    save(dragWidth)
    setDragWidth(null)
  }

  function onKeyDown(event: KeyboardEvent) {
    const step = {ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP}[event.key]

    if (step !== undefined) save(clampWidth(layout.sidebarWidth + step))
  }

  return (
    <SidebarProvider
      className={cn(
        'h-full min-h-0',
        // The sidebar slides on open and close, but follows a drag at once.
        dragWidth !== null &&
          '**:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none'
      )}
      style={style}
      open={layout.sidebarOpen}
      onOpenChange={sidebarOpen => void updateLayout({sidebarOpen})}
    >
      <Sidebar
        collapsible="offcanvas"
        role="complementary"
        inert={!layout.sidebarOpen}
        className="border-r border-sidebar-border"
      >
        {sidebar}
        <div
          role="separator"
          aria-label="Sidebar width"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          className={cn(
            'absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring',
            dragWidth !== null && 'after:bg-sidebar-ring'
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDragWidth(null)}
          onDoubleClick={() => save(DEFAULT_LAYOUT.sidebarWidth)}
          onKeyDown={onKeyDown}
        />
      </Sidebar>
      {children}
    </SidebarProvider>
  )
}
