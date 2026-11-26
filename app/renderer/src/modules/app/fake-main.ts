import type {Attachment} from '@uz/contract/attachments'
import type {Bridge} from '@uz/contract/bridge'
import type {
  Command,
  CommandOutcome,
  CommandResult,
  CommandType,
} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Layout} from '@uz/contract/layout'
import type {Model} from '@uz/contract/providers'
import type {Settings} from '@uz/contract/settings'
import type {SystemPromptEntry} from '@uz/contract/system-prompts'
import type {TreeFile, TreeFileDetails} from '@uz/contract/tree-files'
import type {Tree} from '@uz/contract/trees'
import type {Prompt, Reply, StreamingReply} from '@uz/contract/turns'

import {
  AttachmentMediaTypeSchema,
  FOLDER_MEDIA_TYPE,
} from '@uz/contract/attachments'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {PRESETS, defaultEntry} from '@uz/contract/system-prompts'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'

type AttachmentAdd = Extract<Command, {type: 'attachment.add'}>

type TreeFileCommand = Extract<Command, {type: `tree-file${string}`}>

function isTreeFileCommand(command: Command): command is TreeFileCommand {
  return command.type.startsWith('tree-file')
}

/** A Reply's Snapshot as `tree-files.list` gives it. */
export type FakeSnapshot = CommandResult<'tree-files.list'>

export function treeFile(
  path: string,
  fields: Partial<TreeFile> = {}
): TreeFile {
  return {
    id: crypto.randomUUID().replaceAll('-', ''),
    path,
    size: 12,
    change: null,
    ...fields,
  }
}

export const receivedAt = '2026-10-19T12:00:00.000Z'

export const account = {email: 'sam@example.com', plan: 'Max'}

const fakeModel: Model = {
  id: 'fake',
  name: 'Fake',
  isDefault: true,
  resolvesTo: null,
  needsAppUpdate: false,
}

export function savedTree(fields: Partial<Tree> = {}): Tree {
  return {
    id: crypto.randomUUID(),
    title: null,
    firstLine: null,
    createdAt: receivedAt,
    lastActiveAt: receivedAt,
    unseenFailure: false,
    systemPrompt: {id: crypto.randomUUID(), text: ''},
    tools: DEFAULT_TREE_TOOLS,
    ...fields,
  }
}

interface Saved {
  trees?: Tree[]
  prompts?: Prompt[]
  replies?: Reply[]
  streaming?: StreamingReply[]
  firstLaunch?: boolean
  settings?: Partial<Settings>
  /** The user's own System prompts, after the presets. */
  systemPrompts?: SystemPromptEntry[]
  layout?: Partial<Layout>
  /** By Reply id; a Reply missing here has no files. */
  snapshots?: Record<string, FakeSnapshot>
  /** By file id, over what `tree-file.describe` makes of the listed file. */
  fileDetails?: Record<string, Partial<TreeFileDetails>>
}

/** A dropped folder looks like a plain file to the window. */
function mediaTypeOf(type = '') {
  const known = AttachmentMediaTypeSchema.safeParse(type).data

  if (known && known !== FOLDER_MEDIA_TYPE) return known

  return type.startsWith('text/') ? 'text/plain' : 'application/octet-stream'
}

export type FakeMain = ReturnType<typeof fakeMain>

export function fakeMain(saved: Saved = {}) {
  const trees = [...(saved.trees ?? [])]
  const prompts = [...(saved.prompts ?? [])]
  const replies = [...(saved.replies ?? [])]
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved.settings}
  const layout: Layout = {...DEFAULT_LAYOUT, ...saved.layout}
  const library = [...PRESETS, ...(saved.systemPrompts ?? [])]
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()
  const attachments = new Map<string, Attachment>()
  const dropped = new Map<string, File>()

  function keep({file, shrunk}: AttachmentAdd) {
    const from = file.type === 'dropped' ? dropped.get(file.fileId) : null

    const attachment: Attachment = {
      id: crypto.randomUUID(),
      name: from?.name ?? (file.type === 'pasted' ? file.name : 'file'),
      mediaType: mediaTypeOf(from?.type),
      size: from?.size ?? (file.type === 'pasted' ? file.bytes.byteLength : 0),
      shrunkSize: shrunk?.byteLength ?? null,
      folderPath: null,
      missing: false,
      extraction: null,
    }

    attachments.set(attachment.id, attachment)

    return attachment
  }

  function attachmentsOf(ids: string[] = []) {
    return ids.flatMap(id => attachments.get(id) ?? [])
  }

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function change(index: number, tree: Tree) {
    trees[index] = tree
    publish({type: 'TREE_CHANGED', tree})

    return tree
  }

  function setTools({
    treeId,
    changes,
  }: Extract<Command, {type: 'tree.set-tools'}>): CommandOutcome<CommandType> {
    const index = trees.findIndex(tree => tree.id === treeId)
    const found = trees[index]

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    const tools = {...found.tools, ...changes}

    return {ok: true, value: change(index, {...found, tools})}
  }

  const snapshots = saved.snapshots ?? {}

  function describe(fileId: string): TreeFileDetails | null {
    for (const snapshot of Object.values(snapshots)) {
      const file = snapshot.files.find(one => one.id === fileId)

      if (file) {
        return {
          ...file,
          preview: 'text',
          tooLarge: false,
          notOpened: null,
          link: false,
          onDisk: snapshot.onDisk && file.change !== 'deleted',
          editor: null,
          quickLook: false,
          fileManager: 'finder',
          modified: null,
          ...saved.fileDetails?.[fileId],
        }
      }
    }

    return null
  }

  function answerTreeFile(
    command: TreeFileCommand
  ): CommandOutcome<CommandType> {
    if (command.type === 'tree-files.list') {
      return {
        ok: true,
        value: snapshots[command.replyId] ?? {files: [], onDisk: true},
      }
    }

    if (command.type === 'tree-files.save-copy') {
      return {ok: true, value: {saved: true}}
    }

    const details = describe(command.fileId)

    if (!details) {
      return {ok: false, error: {code: 'not-found', message: 'Gone'}}
    }

    switch (command.type) {
      case 'tree-file.describe':
        return {ok: true, value: details}
      case 'tree-file.save-copy':
        return {ok: true, value: {saved: true}}
      case 'tree-file.thumbnail':
        return {ok: true, value: {dataUrl: null}}
      case 'tree-file.open':
      case 'tree-file.reveal':
        return {ok: true, value: {}}
      default:
        throw new Error('Unknown file command.')
    }
  }

  function systemPrompts() {
    return {entries: library.map(entry => ({...entry}))}
  }

  function changeLibrary(
    command: Extract<Command, {type: `system-prompt.${string}`}>
  ): CommandOutcome<CommandType> {
    const index = library.findIndex(
      entry => 'id' in command && entry.id === command.id && !entry.preset
    )

    if (command.type === 'system-prompt.create') {
      const {name, text} = command
      const entry = {id: crypto.randomUUID(), name, text, preset: false}

      library.push(entry)
      publish({type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: systemPrompts()})

      return {ok: true, value: entry}
    }

    if (index === -1) {
      return {ok: false, error: {code: 'not-found', message: 'Gone'}}
    }

    if (command.type === 'system-prompt.update') {
      const {id, name, text} = command
      const entry = {id, name, text, preset: false}

      library[index] = entry
      publish({type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: systemPrompts()})

      return {ok: true, value: entry}
    }

    library.splice(index, 1)
    publish({type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: systemPrompts()})

    if (settings.defaultSystemPromptId === command.id) {
      settings.defaultSystemPromptId = DEFAULT_SETTINGS.defaultSystemPromptId
      publish({type: 'SETTINGS_CHANGED', settings: {...settings}})
    }

    return {ok: true, value: {}}
  }

  function answer(
    command: Exclude<
      Command,
      | {
          type:
            | 'attachment.add'
            | 'snapshots.download-again'
            | 'image.load'
            | 'tree.set-tools'
        }
      | {type: `system-prompt.${string}`}
      | TreeFileCommand
    >
  ): CommandOutcome<CommandType> {
    if ('provider' in command) return {ok: true, value: {}}

    if (command.type === 'app.ping') {
      return {ok: true, value: {nonce: command.nonce, receivedAt}}
    }

    if (command.type === 'tree.list') {
      return {ok: true, value: {trees: trees.toReversed()}}
    }

    if (command.type === 'settings.update') {
      Object.assign(settings, command.changes)
      publish({type: 'SETTINGS_CHANGED', settings: {...settings}})

      return {ok: true, value: {...settings}}
    }

    if (command.type === 'layout.update') {
      Object.assign(layout, command.changes)
      publish({type: 'LAYOUT_CHANGED', layout: {...layout}})

      return {ok: true, value: {...layout}}
    }

    if (command.type === 'tree.create') {
      const tree = savedTree({
        systemPrompt: {
          id: crypto.randomUUID(),
          text: defaultEntry(library, settings.defaultSystemPromptId).text,
        },
        tools: {...settings.toolDefaults},
      })

      trees.push(tree)
      publish({type: 'TREE_CREATED', tree})

      return {ok: true, value: tree}
    }

    const index = trees.findIndex(tree => tree.id === command.treeId)
    const found = trees[index]

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    if (command.type === 'tree.open') {
      return {
        ok: true,
        value: found.unseenFailure
          ? change(index, {...found, unseenFailure: false})
          : found,
      }
    }

    if (command.type === 'tree.delete') {
      trees.splice(index, 1)
      publish({type: 'TREE_DELETED', treeId: found.id})

      return {ok: true, value: {}}
    }

    if (command.type === 'tree.turns') {
      const {treeId} = command

      return {
        ok: true,
        value: {
          prompts: prompts.filter(prompt => prompt.treeId === treeId),
          replies: replies.filter(reply => reply.treeId === treeId),
        },
      }
    }

    if (command.type === 'prompt.send') {
      const prompt = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        parentReplyId: command.parentReplyId,
        text: command.text,
        attachments: attachmentsOf(command.attachmentIds),
        createdAt: receivedAt,
      }

      const reply: Reply = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        promptId: prompt.id,
        provider: command.model.provider,
        model: command.model.model,
        systemPromptId: found.systemPrompt.id,
        status: 'streaming',
        content: [],
        contextSize: null,
        contextWindow: null,
        failure: null,
        compacted: false,
        rebuilt: false,
        files: [],
        createdAt: receivedAt,
      }

      prompts.push(prompt)
      replies.push(reply)

      return {
        ok: true,
        value: {prompt, reply, removed: {promptIds: [], replyIds: []}},
      }
    }

    if (command.type === 'tree.set-system-prompt') {
      const systemPrompt = {id: crypto.randomUUID(), text: command.text}

      return {ok: true, value: change(index, {...found, systemPrompt})}
    }

    if (command.type === 'tree.rename') {
      return {ok: true, value: change(index, {...found, title: command.title})}
    }

    return {ok: false, error: {code: 'not-found', message: 'Gone'}}
  }

  const bridge: Bridge = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test fake: each answer matches its command by hand
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'attachment.add') {
        return {ok: true, value: {attachment: keep(command)}}
      }

      if (command.type === 'snapshots.download-again') {
        return {ok: true, value: {}}
      }

      if (command.type === 'tree.set-tools') return setTools(command)

      if (isTreeFileCommand(command)) return answerTreeFile(command)

      if (command.type === 'image.load') {
        return {ok: true, value: {dataUrl: 'data:image/png;base64,'}}
      }

      if (
        command.type === 'system-prompt.create' ||
        command.type === 'system-prompt.update' ||
        command.type === 'system-prompt.delete'
      ) {
        return changeLibrary(command)
      }

      return answer(command)
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: saved.streaming ?? [],
        approvals: [],
        providers: [
          saved.firstLaunch
            ? {provider: 'claude', status: 'not-connected', account: null}
            : {provider: 'claude', status: 'ready', account},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        models: {claude: [fakeModel], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: {...settings},
        systemPrompts: systemPrompts(),
        layout: {...layout},
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async file => {
      const id = crypto.randomUUID()

      dropped.set(id, file)

      return {ok: true, id}
    },
  }

  return {...bridge, sent, trees, replies, layout, snapshots, publish}
}
