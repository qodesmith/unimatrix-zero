import {z} from 'zod'

export const SessionFolderSchema = z.strictObject({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1),
})

export type SessionFolder = z.infer<typeof SessionFolderSchema>

export const SessionKeySchema = SessionFolderSchema.extend({
  subpath: z.string().min(1).optional(),
})

export type SessionKey = z.infer<typeof SessionKeySchema>

/**
 * Opaque: kept and given back unchanged, read only for the `uuid` it is
 * deduplicated on and the `type` the vendor's SDK files it by.
 */
export const SessionEntrySchema = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
})

export type SessionEntry = z.infer<typeof SessionEntrySchema>

export const SessionFileSchema = z.strictObject({
  path: z.string().min(1),
  base64: z.string(),
})

export type SessionFile = z.infer<typeof SessionFileSchema>

export const SessionStoreRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('append'),
    key: SessionKeySchema,
    entries: z.array(SessionEntrySchema),
  }),
  z.strictObject({
    op: z.literal('load'),
    key: SessionKeySchema,
    /**
     * Ends the transcript at the entry with this `uuid`, and leaves out every
     * entry that has none.
     */
    through: z.string().min(1).optional(),
  }),
  z.strictObject({op: z.literal('list-subkeys'), ...SessionFolderSchema.shape}),
  z.strictObject({
    op: z.literal('save-files'),
    ...SessionFolderSchema.shape,
    files: z.array(SessionFileSchema),
  }),
  z.strictObject({op: z.literal('load-files'), ...SessionFolderSchema.shape}),
])

export type SessionStoreRequest = z.infer<typeof SessionStoreRequestSchema>

type SessionStoreOp = SessionStoreRequest['op']

export const SESSION_STORE_RESULTS = {
  append: z.null(),
  load: z.array(SessionEntrySchema).nullable(),
  'list-subkeys': z.array(z.string()),
  'save-files': z.null(),
  'load-files': z.array(SessionFileSchema),
} as const satisfies Record<SessionStoreOp, z.ZodType>

export const SessionStoreValueSchema = z.union(
  Object.values(SESSION_STORE_RESULTS)
)

export type SessionStoreValue = z.infer<typeof SessionStoreValueSchema>
