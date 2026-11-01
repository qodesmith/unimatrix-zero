import {z} from 'zod'

/** How the window is arranged, restored on its own; never a Setting (ADR 0021). */
export const LayoutSchema = z.strictObject({
  sidebarOpen: z.boolean(),
})

export type Layout = z.infer<typeof LayoutSchema>

export const DEFAULT_LAYOUT: Layout = {
  sidebarOpen: true,
}

export const LayoutUpdateSchema = LayoutSchema.partial()

export type LayoutUpdate = z.infer<typeof LayoutUpdateSchema>
