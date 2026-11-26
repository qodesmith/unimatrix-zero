import type {ApprovalAction} from '#modules/turns/main'

import {z} from 'zod'

export type {ApprovalAction} from '#modules/turns/main'

/** Full access asks nothing; Supervised brings an approval card. */
export const PermissionModeSchema = z.enum(['full-access', 'supervised'])

export type PermissionMode = z.infer<typeof PermissionModeSchema>

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

export function sameGrant(a: ApprovalGrant, b: ApprovalGrant) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Without the ones already there. */
export function withGrants(
  grants: ApprovalGrant[],
  added: ApprovalGrant[]
): ApprovalGrant[] {
  const all = [...grants]

  for (const grant of added) {
    if (!all.some(kept => sameGrant(kept, grant))) all.push(grant)
  }

  return all
}
