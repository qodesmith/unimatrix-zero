import type {ModelInfo} from '@anthropic-ai/claude-agent-sdk'
import type {Model} from '@uz/contract/providers'

import {DEFAULT_MODEL_ID} from '@uz/contract/providers'
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

/**
 * The SDK lists Models only from a running `claude`, so the list is the one
 * the newest `claude` the driver ran gave, and null before any ran.
 */
export function createModelList() {
  let kept: Model[] | null = null
  const listeners: ((models: Model[]) => void)[] = []

  /** A list that doesn't parse changes nothing. */
  function learn(infos: ModelInfo[]) {
    const parsed = ModelInfosSchema.safeParse(infos)

    if (!parsed.success) return

    const models = parsed.data.map(({value, displayName, resolvedModel}) => ({
      id: value,
      name: displayName,
      isDefault: value === DEFAULT_MODEL_ID,
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

  return {learn, list: () => kept, onChanged}
}
