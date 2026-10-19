import {z} from 'zod'

export const SnapshotEvent = z.strictObject({
  type: z.literal('SNAPSHOT'),
  app: z.strictObject({version: z.string()}),
})

export const EventSchema = z.discriminatedUnion('type', [SnapshotEvent])

export type AppEvent = z.infer<typeof EventSchema>
