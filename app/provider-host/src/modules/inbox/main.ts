/** What happens while a driver waits, taken one at a time in order. */
export function createInbox<T extends object>() {
  const items: T[] = []
  let waiting: ((item: T) => void) | null = null

  return {
    push(item: T) {
      if (waiting) {
        const resolve = waiting
        waiting = null
        resolve(item)
      } else {
        items.push(item)
      }
    },

    async next(): Promise<T> {
      const item = items.shift()

      if (item) return item

      return new Promise<T>(resolve => {
        waiting = resolve
      })
    },
  }
}

export type Inbox<T extends object> = ReturnType<typeof createInbox<T>>
