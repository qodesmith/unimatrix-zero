import {z} from 'zod'

export const SIDEBAR_MIN_WIDTH = 290

export const SIDEBAR_MAX_WIDTH = 640

export const SidebarSectionIdSchema = z.enum(['trees', 'files', 'usage'])

export type SidebarSectionId = z.infer<typeof SidebarSectionIdSchema>

export const SidebarSectionSchema = z.strictObject({
  /** Its share of the sidebar's height while open, in percent. */
  size: z.number().min(0).max(100),
  /** Shrunk to its header; `size` is what expanding restores. */
  collapsed: z.boolean(),
})

export type SidebarSection = z.infer<typeof SidebarSectionSchema>

/** How the window is arranged, restored on its own; never a Setting (ADR 0021). */
export const LayoutSchema = z.strictObject({
  sidebarOpen: z.boolean(),
  /** In CSS pixels. */
  sidebarWidth: z.number().min(SIDEBAR_MIN_WIDTH).max(SIDEBAR_MAX_WIDTH),
  sidebarSections: z.record(SidebarSectionIdSchema, SidebarSectionSchema),
})

export type Layout = z.infer<typeof LayoutSchema>

export const DEFAULT_SIDEBAR_SECTIONS: Layout['sidebarSections'] = {
  trees: {size: 55, collapsed: false},
  files: {size: 30, collapsed: false},
  usage: {size: 15, collapsed: false},
}

export const DEFAULT_LAYOUT: Layout = {
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_MIN_WIDTH,
  sidebarSections: DEFAULT_SIDEBAR_SECTIONS,
}

export const LayoutUpdateSchema = LayoutSchema.partial()

export type LayoutUpdate = z.infer<typeof LayoutUpdateSchema>
