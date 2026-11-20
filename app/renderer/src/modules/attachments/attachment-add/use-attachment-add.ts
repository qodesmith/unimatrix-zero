import type {AttachmentAddEvent, AttachmentAddState} from './machine'
import type {Attachment} from '@uz/contract/attachments'

import {useEffect, useRef, useState} from 'react'

import {useAddFile} from '../add-file'
import {addToMain} from './actions'
import {attachmentAddTransition, startedAdding} from './machine'

/** A file still being added, or one main refused, by a key of its own. */
export type PendingAdd = {key: string} & Exclude<
  AttachmentAddState,
  {status: 'added'}
>

type Adds = ReadonlyMap<string, AttachmentAddState>

/**
 * Adds files one at a time, so they reach the draft in the order they were
 * attached. Each added one goes to `onAdded` and leaves the pending list; a
 * refused one stays, with main's message, until dismissed.
 */
export function useAttachmentAdds(onAdded: (attachment: Attachment) => void) {
  const addFile = useAddFile()
  const [adds, setAdds] = useState<Adds>(new Map())
  const latest = useRef(adds)
  const queue = useRef(Promise.resolve())
  const added = useRef(onAdded)

  useEffect(() => {
    added.current = onAdded
  }, [onAdded])

  function put(next: Adds) {
    latest.current = next
    setAdds(next)
  }

  function send(key: string, event: AttachmentAddEvent) {
    const before = latest.current.get(key)
    const after = before && attachmentAddTransition(before, event)

    if (!after || after === before) return false

    const next = new Map(latest.current)

    if (after.status === 'added') next.delete(key)
    else next.set(key, after)

    put(next)

    return true
  }

  function attach(files: readonly File[]) {
    const next = new Map(latest.current)

    for (const file of files) {
      const key = crypto.randomUUID()

      next.set(key, startedAdding(file.name))
      queue.current = queue.current
        .then(async () =>
          addToMain({
            file,
            runAdd: addFile,
            send: event => send(key, event),
            onAdded: attachment => added.current(attachment),
          })
        )
        .catch(() => {
          send(key, {type: 'refused', error: 'Couldn’t attach this file'})
        })
    }

    put(next)
  }

  function dismiss(key: string) {
    const next = new Map(latest.current)

    if (next.delete(key)) put(next)
  }

  const pending = [...adds].flatMap(([key, add]): PendingAdd[] =>
    add.status === 'added' ? [] : [{key, ...add}]
  )

  return {pending, attach, dismiss}
}
