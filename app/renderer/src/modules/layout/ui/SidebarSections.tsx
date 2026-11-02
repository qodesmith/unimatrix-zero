import type {SectionLayout} from '../sidebar-sections'
import type {SidebarSectionId} from '@uz/contract/layout'
import type {ReactNode, RefObject} from 'react'
import type {Layout as PanelLayout} from 'react-resizable-panels'

import {Button} from '#shadcn/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#shadcn/ui/resizable'
import {ChevronDownIcon, ChevronRightIcon} from 'lucide-react'
import {Fragment, useId, useLayoutEffect, useRef} from 'react'
import {useGroupRef} from 'react-resizable-panels'

import {SECTION_IDS, arrange, resetSplit, resized} from '../sidebar-sections'
import {useLayout, useUpdateLayout} from '../use-layout'

export interface SectionContent {
  title: string
  /** Buttons at the header's end, shown while collapsed too. */
  actions?: ReactNode
  children?: ReactNode
}

const MIN_HEIGHT: Record<SidebarSectionId, string> = {
  trees: '120px',
  files: '180px',
  usage: '90px',
}

// The header's `h-8`, which is all a collapsed section shows.
const HEADER_HEIGHT = '2rem'

const TOGGLE_MS = 200

function sectionLayout(layout: PanelLayout): SectionLayout {
  return {
    trees: layout.trees ?? 0,
    files: layout.files ?? 0,
    usage: layout.usage ?? 0,
  }
}

function headerShare(
  group: RefObject<HTMLDivElement | null>,
  header: RefObject<HTMLDivElement | null>
) {
  const panels = [...(group.current?.children ?? [])].filter(
    child => child instanceof HTMLElement && child.hasAttribute('data-panel')
  )

  const height = panels.reduce(
    (sum, panel) =>
      sum + (panel instanceof HTMLElement ? panel.offsetHeight : 0),
    0
  )

  return height === 0 ? 0 : ((header.current?.offsetHeight ?? 0) / height) * 100
}

/**
 * The sidebar's sections, VS Code Explorer style: dividers to drag, and
 * headers that collapse a section to themselves, all kept in the Layout.
 */
export function SidebarSections(
  props: Record<SidebarSectionId, SectionContent>
) {
  const {sidebarSections: sections} = useLayout()
  const updateLayout = useUpdateLayout()
  const groupRef = useGroupRef()
  const groupElement = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLDivElement>(null)
  const toggled = useRef(false)
  const anyOpen = SECTION_IDS.some(id => !sections[id].collapsed)

  useLayoutEffect(() => {
    const group = groupElement.current
    let current = true

    if (toggled.current) {
      toggled.current = false
      group?.setAttribute('data-toggling', '')
    }

    const settled = setTimeout(() => {
      group?.removeAttribute('data-toggling')
    }, TOGGLE_MS)

    function apply() {
      if (current) {
        groupRef.current?.setLayout(
          arrange(sections, headerShare(groupElement, header))
        )
      }
    }

    apply()
    // A Panel whose constraints changed registers again after this effect,
    // and the Group checks the layout against the old ones until it has.
    queueMicrotask(apply)

    return () => {
      current = false
      clearTimeout(settled)
    }
  }, [groupRef, sections])

  function save(next: typeof sections) {
    void updateLayout({sidebarSections: next})
  }

  function onDragged(layout: PanelLayout) {
    const next = resized(
      sections,
      sectionLayout(layout),
      headerShare(groupElement, header)
    )

    const moved = SECTION_IDS.some(
      id => Math.abs(next[id].size - sections[id].size) > 0.01
    )

    if (moved) save(next)
  }

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1 motion-safe:[&[data-toggling]>[data-panel]]:transition-[flex-grow] motion-safe:[&[data-toggling]>[data-panel]]:duration-200 motion-safe:[&[data-toggling]>[data-panel]]:ease-out"
      groupRef={groupRef}
      elementRef={groupElement}
      defaultLayout={arrange(sections, 0)}
      onLayoutChanged={(layout, meta) => {
        if (meta.isUserInteraction) onDragged(layout)
      }}
    >
      {SECTION_IDS.map((id, index) => {
        const above = SECTION_IDS[index - 1]
        const {collapsed} = sections[id]

        return (
          <Fragment key={id}>
            {above !== undefined && (
              <ResizableHandle
                disabled={collapsed || sections[above].collapsed}
                disableDoubleClick
                onDoubleClick={() => {
                  if (!collapsed && !sections[above].collapsed) {
                    save(resetSplit(sections, above, id))
                  }
                }}
              />
            )}
            <ResizablePanel
              id={id}
              minSize={MIN_HEIGHT[id]}
              collapsible={collapsed}
              collapsedSize={HEADER_HEIGHT}
              groupResizeBehavior={
                collapsed && anyOpen
                  ? 'preserve-pixel-size'
                  : 'preserve-relative-size'
              }
            >
              <Section
                {...props[id]}
                headerRef={id === 'trees' ? header : undefined}
                collapsed={collapsed}
                onToggle={() => {
                  toggled.current = true
                  save({
                    ...sections,
                    [id]: {...sections[id], collapsed: !collapsed},
                  })
                }}
              />
            </ResizablePanel>
          </Fragment>
        )
      })}
    </ResizablePanelGroup>
  )
}

interface SectionProps extends SectionContent {
  collapsed: boolean
  headerRef: RefObject<HTMLDivElement | null> | undefined
  onToggle: () => void
}

function Section({
  title,
  actions,
  children,
  collapsed,
  headerRef,
  onToggle,
}: SectionProps) {
  const headingId = useId()
  const bodyId = useId()

  return (
    <section aria-labelledby={headingId} className="flex h-full flex-col">
      <div ref={headerRef} className="flex h-8 shrink-0 items-center pr-2">
        <h2 id={headingId} className="min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="h-8 w-full justify-start gap-1 rounded-none px-2 text-xs font-semibold hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
            onClick={onToggle}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            {title}
          </Button>
        </h2>
        {actions}
      </div>
      <div
        id={bodyId}
        hidden={collapsed}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {children}
      </div>
    </section>
  )
}
