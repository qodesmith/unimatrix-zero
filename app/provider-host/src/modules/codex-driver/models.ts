import type {AppServer} from './app-server'
import type {ResponseOf} from './wire'
import type {Model} from '@uz/contract/providers'

/**
 * Each entry's `model` is the slug `thread/start` and `turn/start` take, and
 * the one their answers name, so a Reply records the id the picker showed.
 */
export async function readModels(server: AppServer) {
  const models: Model[] = []
  let cursor: string | null = null

  do {
    const page: ResponseOf<'model/list'> = await server.request('model/list', {
      cursor,
    })

    for (const {model, displayName, isDefault} of page.data) {
      models.push({
        id: model,
        name: displayName,
        isDefault,
        resolvesTo: null,
        needsAppUpdate: false,
      })
    }

    cursor = page.nextCursor
  } while (cursor !== null)

  return models
}
