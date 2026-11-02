import type {CSSProperties, ReactNode} from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#shadcn/ui/resizable'
import {Sidebar, SidebarProvider} from '#shadcn/ui/sidebar'
import {
  DEFAULT_LAYOUT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '@uz/contract/layout'
import {cn} from 'cn'
import {useLayoutEffect, useRef} from 'react'
import {usePanelRef} from 'react-resizable-panels'

import {useLayout, useUpdateLayout} from '../use-layout'

function clampWidth(width: number) {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
  )
}

interface LayoutSidebarProps {
  sidebar: ReactNode
  children: ReactNode
}

/**
 * The app sidebar beside the main area, open or closed and as wide as the
 * Layout says. A drag of the divider between them saves only where it ends.
 */
export function LayoutSidebar({sidebar, children}: LayoutSidebarProps) {
  const layout = useLayout()
  const updateLayout = useUpdateLayout()
  const panelRef = usePanelRef()
  const groupElement = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(layout.sidebarOpen)
  const {sidebarOpen: open, sidebarWidth: width} = layout

  const style: CSSProperties & Record<'--sidebar-width', string> = {
    '--sidebar-width': `${width}px`,
  }

  useLayoutEffect(() => {
    const group = groupElement.current
    let current = true

    if (wasOpen.current !== open) {
      wasOpen.current = open
      group?.setAttribute('data-toggling', '')
    }

    function apply() {
      if (!current) return

      if (open) panelRef.current?.resize(`${width}px`)
      else panelRef.current?.collapse()
    }

    async function settle() {
      const panels = [...(group?.children ?? [])]

      await Promise.allSettled(
        panels
          .flatMap(panel => panel.getAnimations())
          .map(async animation => animation.finished)
      )

      if (current) group?.removeAttribute('data-toggling')
    }

    apply()
    // The Panel turns collapsible only once it registers again, after this.
    queueMicrotask(apply)
    const frame = requestAnimationFrame(() => void settle())

    return () => {
      current = false
      cancelAnimationFrame(frame)
    }
  }, [open, panelRef, width])

  function save(sidebarWidth: number) {
    if (sidebarWidth !== width) void updateLayout({sidebarWidth})
  }

  return (
    <SidebarProvider
      className="h-full min-h-0"
      style={style}
      open={open}
      onOpenChange={sidebarOpen => void updateLayout({sidebarOpen})}
    >
      <ResizablePanelGroup
        className="motion-safe:[&[data-toggling]>[data-panel]]:transition-[flex-grow] motion-safe:[&[data-toggling]>[data-panel]]:duration-slide motion-safe:[&[data-toggling]>[data-panel]]:ease-slide"
        elementRef={groupElement}
        onLayoutChanged={(panels, meta) => {
          const share = panels.sidebar
          const groupWidth = groupElement.current?.offsetWidth

          if (meta.isUserInteraction && open && share && groupWidth) {
            save(clampWidth((share / 100) * groupWidth))
          }
        }}
      >
        <ResizablePanel
          id="sidebar"
          panelRef={panelRef}
          defaultSize={open ? `${width}px` : 0}
          minSize={`${SIDEBAR_MIN_WIDTH}px`}
          maxSize={`${SIDEBAR_MAX_WIDTH}px`}
          collapsible={!open}
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
          className="flex justify-end"
          style={{overflow: 'hidden'}}
        >
          <Sidebar
            collapsible="none"
            role="complementary"
            inert={!open}
            // Closed, opening or closing, it keeps its width and slides out
            // past the Panel's left edge.
            className={cn(
              'w-full shrink-0 border-r border-sidebar-border in-data-toggling:w-(--sidebar-width)',
              !open && 'w-(--sidebar-width)'
            )}
          >
            {sidebar}
          </Sidebar>
        </ResizablePanel>
        <ResizableHandle
          aria-label="Sidebar width"
          disabled={!open}
          disableDoubleClick
          inert={!open}
          className="w-0 bg-transparent after:z-20 after:w-0.5 hover:after:bg-sidebar-ring focus-visible:ring-0 focus-visible:after:bg-sidebar-ring data-[separator=active]:after:bg-sidebar-ring"
          onDoubleClick={() => save(DEFAULT_LAYOUT.sidebarWidth)}
        />
        <ResizablePanel id="main" className="flex flex-col">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </SidebarProvider>
  )
}
