import {z} from 'zod'

/** Full access asks nothing; Supervised brings an approval card. */
export const PermissionModeSchema = z.enum(['full-access', 'supervised'])

export type PermissionMode = z.infer<typeof PermissionModeSchema>

/** What an approval card asks about. Reads never ask, so none is a read. */
export const ApprovalActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('edit'),
    /** Absolute, in the order the Provider named them. */
    paths: z.array(z.string().min(1)).min(1),
    /** Every path is inside the Tree's files, so the Branch versions it. */
    inTreeFiles: z.boolean(),
  }),
  z.strictObject({kind: z.literal('command'), command: z.string()}),
  z.strictObject({kind: z.literal('host'), host: z.string().min(1)}),
  z.strictObject({
    kind: z.literal('mcp-tool'),
    server: z.string(),
    tool: z.string(),
  }),
  /** Any other tool, by the name the Provider gives it. */
  z.strictObject({kind: z.literal('tool'), name: z.string().min(1)}),
])

export type ApprovalAction = z.infer<typeof ApprovalActionSchema>

/** One "Always allow in this Tree", for every Branch of the Tree. */
export const ApprovalGrantSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('edits-in-tree')}),
  z.strictObject({kind: z.literal('edit'), path: z.string().min(1)}),
  z.strictObject({kind: z.literal('command'), command: z.string()}),
  z.strictObject({kind: z.literal('host'), host: z.string().min(1)}),
  z.strictObject({
    kind: z.literal('mcp-tool'),
    server: z.string(),
    tool: z.string(),
  }),
  z.strictObject({kind: z.literal('tool'), name: z.string().min(1)}),
])

export type ApprovalGrant = z.infer<typeof ApprovalGrantSchema>

/** What "Always allow in this Tree" on this action grants. */
export function grantsFor(action: ApprovalAction): ApprovalGrant[] {
  switch (action.kind) {
    case 'edit':
      return action.inTreeFiles
        ? [{kind: 'edits-in-tree'}]
        : action.paths.map(path => ({kind: 'edit', path}))
    case 'command':
      return [{kind: 'command', command: action.command}]
    case 'host':
      return [{kind: 'host', host: action.host}]
    case 'mcp-tool':
      return [{kind: 'mcp-tool', server: action.server, tool: action.tool}]
    case 'tool':
      return [{kind: 'tool', name: action.name}]
    default:
      throw new Error('Unknown action.')
  }
}

function sameGrant(a: ApprovalGrant, b: ApprovalGrant) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** An edit is granted when each of its paths is. */
export function isGranted(grants: ApprovalGrant[], action: ApprovalAction) {
  return grantsFor(action).every(wanted =>
    grants.some(grant => sameGrant(grant, wanted))
  )
}

/** Without the ones already there. */
export function withGrants(
  grants: ApprovalGrant[],
  added: ApprovalGrant[]
): ApprovalGrant[] {
  return added.reduce(
    (all, grant) =>
      all.some(kept => sameGrant(kept, grant)) ? all : [...all, grant],
    grants
  )
}

/** Only an edit inside the Tree's files is versioned with the Branch. */
export function landsOutsideTree(action: ApprovalAction) {
  return !(action.kind === 'edit' && action.inTreeFiles)
}
