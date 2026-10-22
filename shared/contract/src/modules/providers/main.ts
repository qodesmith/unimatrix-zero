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

/** The account a Provider is signed in with, as its vendor program reports it. */
export const AccountSchema = z.strictObject({
  email: z.string(),
  plan: z.string(),
})

export type Account = z.infer<typeof AccountSchema>

export const ConnectionSchema = z.discriminatedUnion('status', [
  z.strictObject({status: z.literal('signed-in'), account: AccountSchema}),
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

/**
 * Where a Provider stands. `account` is set once it is connected; the other
 * statuses are its host's.
 */
export const ProviderStatusSchema = z.strictObject({
  provider: ProviderIdSchema,
  status: z.enum([
    'not-connected',
    'starting',
    'ready',
    'restarting',
    'signed-out',
    'failed',
  ]),
  account: AccountSchema.nullable(),
})

export type ProviderStatus = z.infer<typeof ProviderStatusSchema>

export const ProviderStatusEvent = ProviderStatusSchema.extend({
  type: z.literal('PROVIDER_STATUS'),
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

/** A step of connecting a Provider, as its host reports it. */
export const SignInStepUpdate = z.strictObject({
  type: z.literal('SIGN_IN_STEP'),
  step: z.enum(['get-ready', 'sign-in-page', 'paste-code', 'check-plan']),
  /** The Provider's sign-in page, from `sign-in-page` on. */
  url: z.url().optional(),
  /** The vendor program's download, during `get-ready`. */
  progress: z
    .strictObject({
      receivedBytes: z.int().min(0),
      totalBytes: z.int().min(0),
    })
    .optional(),
  /** The pasted code was not the one the sign-in page showed. */
  wrongCode: z.literal(true).optional(),
})

export const SignInFailureSchema = z.strictObject({
  reason: z.enum(['download-failed', 'no-answer', 'free-plan', 'failed']),
  message: z.string(),
})

export type SignInFailure = z.infer<typeof SignInFailureSchema>

const SignInConnected = z.strictObject({
  type: z.literal('SIGN_IN_FINISHED'),
  outcome: z.literal('connected'),
  account: AccountSchema,
})

const SignInCanceled = z.strictObject({
  type: z.literal('SIGN_IN_FINISHED'),
  outcome: z.literal('canceled'),
})

const SignInFailed = z.strictObject({
  type: z.literal('SIGN_IN_FINISHED'),
  outcome: z.literal('failed'),
  failure: SignInFailureSchema,
})

export const SignInFinishedUpdate = z.discriminatedUnion('outcome', [
  SignInConnected,
  SignInCanceled,
  SignInFailed,
])

export type SignInFinished = z.infer<typeof SignInFinishedUpdate>

export const SIGN_IN_CANCELED: SignInFinished = {
  type: 'SIGN_IN_FINISHED',
  outcome: 'canceled',
}

export function signInFailed(
  reason: SignInFailure['reason'],
  message: string
): SignInFinished {
  return {
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason, message},
  }
}

export const SignInUpdateSchema = z.discriminatedUnion('type', [
  SignInStepUpdate,
  SignInFinishedUpdate,
])

export type SignInUpdate = z.infer<typeof SignInUpdateSchema>

export const SignInStepEvent = SignInStepUpdate.extend({
  provider: ProviderIdSchema,
})

export type SignInStep = z.infer<typeof SignInStepEvent>

export const SignInFinishedEvent = z.discriminatedUnion('outcome', [
  SignInConnected.extend({provider: ProviderIdSchema}),
  SignInCanceled.extend({provider: ProviderIdSchema}),
  SignInFailed.extend({provider: ProviderIdSchema}),
])

export const ProviderEventSchema = z.discriminatedUnion('type', [
  ProviderStatusEvent,
  UsageUpdatedEvent,
  McpServerStatusEvent,
  ModelsChangedEvent,
  SignInStepEvent,
  SignInFinishedEvent,
])

export type ProviderEvent = z.infer<typeof ProviderEventSchema>
