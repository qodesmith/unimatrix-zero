import type {Layout, SidebarSectionId} from '@uz/contract/layout'

import {
  DEFAULT_SIDEBAR_SECTIONS,
  SidebarSectionIdSchema,
} from '@uz/contract/layout'

type Sections = Layout['sidebarSections']

/** Each section's share of the sidebar's height, in percent. */
export type SectionLayout = Record<SidebarSectionId, number>

/** Top to bottom. */
export const SECTION_IDS = SidebarSectionIdSchema.options

function openIds(sections: Sections) {
  return SECTION_IDS.filter(id => !sections[id].collapsed)
}

function openTotal(sections: Sections) {
  return openIds(sections).reduce((sum, id) => sum + sections[id].size, 0)
}

function free(sections: Sections, headerShare: number) {
  return 100 - (SECTION_IDS.length - openIds(sections).length) * headerShare
}

/**
 * Collapsed sections get `headerShare`, their header's share of the height;
 * the open ones share the rest as their sizes do.
 */
export function arrange(
  sections: Sections,
  headerShare: number
): SectionLayout {
  const open = openIds(sections)
  const space = free(sections, headerShare)
  const total = openTotal(sections)

  function share(id: SidebarSectionId) {
    if (sections[id].collapsed) return headerShare

    return total === 0
      ? space / open.length
      : (space * sections[id].size) / total
  }

  const layout = {
    trees: share('trees'),
    files: share('files'),
    usage: share('usage'),
  }

  return open.length === 0
    ? {...layout, usage: 100 - (SECTION_IDS.length - 1) * headerShare}
    : layout
}

/**
 * The sizes that `arrange` lays out as `layout`, a collapsed section keeping
 * its own.
 */
export function resized(
  sections: Sections,
  layout: SectionLayout,
  headerShare: number
): Sections {
  const space = free(sections, headerShare)
  const total = openTotal(sections) || space

  function section(id: SidebarSectionId) {
    return sections[id].collapsed
      ? sections[id]
      : {...sections[id], size: (layout[id] / space) * total}
  }

  return {
    trees: section('trees'),
    files: section('files'),
    usage: section('usage'),
  }
}

/**
 * The two sections on either side of a divider split their space as the
 * defaults do.
 */
export function resetSplit(
  sections: Sections,
  above: SidebarSectionId,
  below: SidebarSectionId
): Sections {
  const space = sections[above].size + sections[below].size
  const defaultAbove = DEFAULT_SIDEBAR_SECTIONS[above].size
  const defaultSpace = defaultAbove + DEFAULT_SIDEBAR_SECTIONS[below].size
  const sizeAbove = (space * defaultAbove) / defaultSpace

  return {
    ...sections,
    [above]: {...sections[above], size: sizeAbove},
    [below]: {...sections[below], size: space - sizeAbove},
  }
}
