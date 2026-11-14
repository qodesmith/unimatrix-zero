import type {Attachment} from '@uz/contract/attachments'
import type {Command} from '@uz/contract/commands'

import {bridge} from '#modules/bridge/main'

export type AddOutcome =
  | {ok: true; attachment: Attachment}
  | {ok: false; error: string}

type AddedFile = Extract<Command, {type: 'attachment.add'}>['file']

/**
 * A picked or dropped File goes by the id main gave its path, so the page
 * never reads one. Only a File with no path, such as a pasted screenshot,
 * goes by its bytes.
 */
async function fileToAdd(
  file: File
): Promise<{ok: true; file: AddedFile} | {ok: false; error: string}> {
  const registered = await bridge().registerDroppedFile(file)

  if (registered.ok) {
    return {ok: true, file: {type: 'dropped', fileId: registered.id}}
  }

  if (registered.error.code !== 'no-path') {
    return {ok: false, error: registered.error.message}
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  return {ok: true, file: {type: 'pasted', name: file.name, bytes}}
}

async function addFile(file: File): Promise<AddOutcome> {
  const toAdd = await fileToAdd(file)

  if (!toAdd.ok) return toAdd

  const outcome = await bridge().send({
    type: 'attachment.add',
    file: toAdd.file,
  })

  return outcome.ok
    ? {ok: true, attachment: outcome.value.attachment}
    : {ok: false, error: outcome.error.message}
}

/** Main keeps a copy of the file for good, for a Prompt to send. */
export function useAddFile() {
  return addFile
}
