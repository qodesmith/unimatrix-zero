import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {TreeFileDetails} from '@uz/contract/tree-files'

export const treeId = '019ab3c0-5e1f-7000-8000-000000000001'

export const replyId = '019ab3c0-5e1f-7000-8000-000000000002'

export function fileDetails(
  path: string,
  fields: Partial<TreeFileDetails> = {}
): TreeFileDetails {
  return {
    id: crypto.randomUUID().replaceAll('-', ''),
    path,
    size: 12,
    change: null,
    preview: 'text',
    tooLarge: false,
    notOpened: null,
    link: false,
    onDisk: true,
    editor: null,
    quickLook: false,
    fileManager: 'finder',
    modified: null,
    ...fields,
  }
}

interface FakeMainOptions {
  file: TreeFileDetails
  onDisk?: boolean
  thumbnail?: string
  refuses?: string
}

export function fakeMain({file, onDisk, thumbnail, refuses}: FakeMainOptions) {
  const sent: Command[] = []

  const listed = {
    id: file.id,
    path: file.path,
    size: file.size,
    change: file.change,
  }

  function answer(command: Command): CommandOutcome<CommandType> {
    if (command.type === 'tree-files.list') {
      const value = {files: [listed], onDisk: onDisk ?? file.onDisk}

      return {ok: true, value}
    }

    if (command.type === 'tree-file.describe') return {ok: true, value: file}

    if (command.type === 'tree-file.thumbnail') {
      return {ok: true, value: {dataUrl: thumbnail ?? null}}
    }

    if (refuses !== undefined) {
      return {ok: false, error: {code: 'handler-failed', message: refuses}}
    }

    return command.type.endsWith('save-copy')
      ? {ok: true, value: {saved: true}}
      : {ok: true, value: {}}
  }

  const bridge: Bridge = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test fake: each answer matches its command by hand
    send: (async (command: Command) => {
      sent.push(command)

      return answer(command)
    }) as Bridge['send'],
    subscribe: () => () => undefined,
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
}
