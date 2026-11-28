/**
 * Runs `task` at most `limit` at a time; after a throw, none start and the
 * first error is rethrown once the running ones settle.
 */
export async function mapLimited<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<Result>
) {
  const results: Result[] = []
  const queue = items.entries()
  let failed = false

  async function worker() {
    for (const [index, item] of queue) {
      if (failed) return

      try {
        results[index] = await task(item)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }

  const workers = await Promise.allSettled(Array.from({length: limit}, worker))
  const rejected = workers.find(settled => settled.status === 'rejected')

  if (rejected) throw rejected.reason

  return results
}
