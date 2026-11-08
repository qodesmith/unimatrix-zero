import type {ModelInfo} from '@anthropic-ai/claude-agent-sdk'
import type {SignInRequest} from '@uz/contract/host'
import type {Model} from '@uz/contract/providers'

import {isDeepStrictEqual} from 'node:util'
import {z} from 'zod'

const ModelInfosSchema = z.array(
  z.looseObject({
    value: z.string().min(1),
    displayName: z.string().min(1),
    resolvedModel: z.string().min(1).optional(),
  })
) satisfies z.ZodType<
  Pick<ModelInfo, 'value' | 'displayName' | 'resolvedModel'>[]
>

/** The SDK's entry for the Model `claude` runs when given none. */
const SDK_DEFAULT = 'default'

/** Starts a `claude` to read the Models it lists. */
export type ReadModels = (vendorProgram: SignInRequest) => Promise<ModelInfo[]>

/**
 * The SDK lists Models only from a running `claude`, so the list is the one
 * the newest `claude` the driver ran gave. Before any ran, `list` starts one.
 */
export function createModelList(read: ReadModels) {
  let kept: Model[] | null = null
  let reading: Promise<Model[]> | null = null
  const listeners: ((models: Model[]) => void)[] = []

  /** A list that doesn't parse changes nothing. */
  function learn(infos: ModelInfo[]) {
    const parsed = ModelInfosSchema.safeParse(infos)

    if (!parsed.success) return

    const models = parsed.data.map(({value, displayName, resolvedModel}) => ({
      id: value,
      name: displayName,
      isDefault: value === SDK_DEFAULT,
      resolvesTo: resolvedModel ?? null,
      needsAppUpdate: false,
    }))

    if (isDeepStrictEqual(models, kept)) return

    kept = models

    for (const listener of listeners) listener(models)
  }

  function onChanged(listener: (models: Model[]) => void) {
    listeners.push(listener)
  }

  /** The Model a listed name stands for, and any other name as it is. */
  function resolve(id: string) {
    return kept?.find(model => model.id === id)?.resolvesTo ?? id
  }

  async function readList(vendorProgram: SignInRequest) {
    learn(await read(vendorProgram))

    if (!kept) throw new Error('Claude listed no Models the app can read.')

    return kept
  }

  async function list(vendorProgram: SignInRequest) {
    if (kept) return kept

    reading ??= readList(vendorProgram).finally(() => {
      reading = null
    })

    return reading
  }

  return {learn, list, onChanged, resolve}
}
