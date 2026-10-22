import {z} from 'zod'

/** One Provider session's transcript, or a Subagent's inside it. */
export const SessionKeySchema = z.strictObject({
  projectKey: z.string().min(1),
  sessionId: z.string().min(1),
  /** Set for a Subagent's transcript; absent for the session's own. */
  subpath: z.string().min(1).optional(),
})

export type SessionKey = z.infer<typeof SessionKeySchema>

/**
 * One transcript entry as the vendor program wrote it. Opaque: kept and given
 * back unchanged, never read beyond the `uuid` it is deduplicated on.
 */
export const SessionEntrySchema = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
})

export type SessionEntry = z.infer<typeof SessionEntrySchema>

/**
 * A file the vendor program keeps beside a session, such as a large tool
 * result.
 */
export const SessionFileSchema = z.strictObject({
  /** Relative to the session's own folder, with `/` between parts. */
  path: z.string().min(1),
  base64: z.string(),
})

export type SessionFile = z.infer<typeof SessionFileSchema>

const sessionFolder = {
  projectKey: z.string().min(1),
  sessionId: z.string().min(1),
}

/** What a Provider host asks main to keep, or give back, of its sessions. */
export const SessionStoreRequestSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('append'),
    key: SessionKeySchema,
    entries: z.array(SessionEntrySchema),
  }),
  z.strictObject({op: z.literal('load'), key: SessionKeySchema}),
  z.strictObject({op: z.literal('list-subkeys'), ...sessionFolder}),
  z.strictObject({
    op: z.literal('save-files'),
    ...sessionFolder,
    files: z.array(SessionFileSchema),
  }),
  z.strictObject({op: z.literal('load-files'), ...sessionFolder}),
])

export type SessionStoreRequest = z.infer<typeof SessionStoreRequestSchema>

type SessionStoreOp = SessionStoreRequest['op']

/** What main answers to each request. */
export const SESSION_STORE_RESULTS = {
  append: z.null(),
  /** Null when nothing was ever kept for the key. */
  load: z.array(SessionEntrySchema).nullable(),
  'list-subkeys': z.array(z.string()),
  'save-files': z.null(),
  'load-files': z.array(SessionFileSchema),
} as const satisfies Record<SessionStoreOp, z.ZodType>

/**
 * Any request's answer; each op's own schema in `SESSION_STORE_RESULTS` tells
 * which.
 */
export const SessionStoreValueSchema = z.union(
  Object.values(SESSION_STORE_RESULTS)
)

export type SessionStoreValue = z.infer<typeof SessionStoreValueSchema>
