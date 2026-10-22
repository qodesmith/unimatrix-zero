import {z} from 'zod'

export const ProviderIdSchema = z.enum(['claude', 'chatgpt'])

export type ProviderId = z.infer<typeof ProviderIdSchema>

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
}

/** What a driver can do. The UI branches on these, never on the Provider. */
export const CapabilitiesSchema = z.strictObject({
  pdfAttachments: z.boolean(),
  skillScriptsInPlainTrees: z.boolean(),
  mcpOAuth: z.boolean(),
  sseMcp: z.boolean(),
  sessionFromTranscript: z.boolean(),
})

export type Capabilities = z.infer<typeof CapabilitiesSchema>

export const ModelSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
})

export type Model = z.infer<typeof ModelSchema>

export const ConnectionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('signed-in'),
    account: z.strictObject({email: z.string(), plan: z.string()}),
  }),
  z.strictObject({status: z.literal('signed-out')}),
])

export type Connection = z.infer<typeof ConnectionSchema>

export const UsageSchema = z.strictObject({
  windows: z.array(
    z.strictObject({
      label: z.string(),
      usedPercent: z.number().min(0).max(100),
      resetsAt: z.iso.datetime().nullable(),
    })
  ),
})

export type Usage = z.infer<typeof UsageSchema>

export const ProviderStatusEvent = z.strictObject({
  type: z.literal('PROVIDER_STATUS'),
  provider: ProviderIdSchema,
  status: z.enum(['starting', 'ready', 'restarting', 'signed-out', 'failed']),
})

export const UsageUpdatedEvent = z.strictObject({
  type: z.literal('USAGE_UPDATED'),
  provider: ProviderIdSchema,
  usage: UsageSchema,
})

export const McpServerStatusEvent = z.strictObject({
  type: z.literal('MCP_SERVER_STATUS'),
  provider: ProviderIdSchema,
  serverId: z.string(),
  status: z.enum(['pending', 'connected', 'needs-sign-in', 'failed']),
})

export const ModelsChangedEvent = z.strictObject({
  type: z.literal('MODELS_CHANGED'),
  provider: ProviderIdSchema,
  models: z.array(ModelSchema),
})

export const SignInStepEvent = z.strictObject({
  type: z.literal('SIGN_IN_STEP'),
  provider: ProviderIdSchema,
  step: z.enum(['get-ready', 'sign-in-page', 'paste-code', 'check-plan']),
  url: z.url().optional(),
})

export const SignInFinishedEvent = z.strictObject({
  type: z.literal('SIGN_IN_FINISHED'),
  provider: ProviderIdSchema,
  outcome: z.enum(['connected', 'canceled', 'failed']),
  message: z.string().optional(),
})

export const ProviderEventSchema = z.discriminatedUnion('type', [
  ProviderStatusEvent,
  UsageUpdatedEvent,
  McpServerStatusEvent,
  ModelsChangedEvent,
  SignInStepEvent,
  SignInFinishedEvent,
])

export type ProviderEvent = z.infer<typeof ProviderEventSchema>
