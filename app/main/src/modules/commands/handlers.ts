import type {Attachments} from '#modules/attachments/main'
import type {Connections} from '#modules/connections/main'
import type {LayoutStore} from '#modules/layout/main'
import type {RemoteImages} from '#modules/remote-images/main'
import type {SettingsStore} from '#modules/settings/main'
import type {SystemPrompts} from '#modules/system-prompts/main'
import type {TreeFiles} from '#modules/tree-files/main'
import type {Trees} from '#modules/trees/main'
import type {Turns} from '#modules/turns/main'
import type {Command, CommandResult, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

export interface HandlerDeps {
  now: () => Date
  trees: Trees
  turns: Turns
  treeFiles: Pick<
    TreeFiles,
    | 'withChangedFiles'
    | 'listFiles'
    | 'saveFilesCopy'
    | 'describeFile'
    | 'openFile'
    | 'revealFile'
    | 'saveFileCopy'
    | 'thumbnail'
  >
  connections: Pick<
    Connections,
    'connect' | 'openPage' | 'submitCode' | 'cancel'
  >
  attachments: Pick<Attachments, 'add' | 'withMissingCopies'>
  images: RemoteImages
  settings: SettingsStore
  systemPrompts: SystemPrompts
  layout: LayoutStore
  downloadGitAgain: () => void
  publish: (event: AppEvent) => void
}

export class NotFoundError extends Error {
  override name = 'NotFoundError'
}

type Handler<T extends CommandType> = (
  command: Extract<Command, {type: T}>,
  deps: HandlerDeps
) => Promise<CommandResult<T>> | CommandResult<T>

type Handlers = {[T in CommandType]: Handler<T>}

function found(tree: Tree | null): Tree {
  if (!tree) throw new NotFoundError('That Tree no longer exists.')

  return tree
}

const REPLY_GONE = 'That Reply no longer exists.'

function replyFound<T>(value: T | null): T {
  if (value === null) throw new NotFoundError(REPLY_GONE)

  return value
}

function fileFound<T>(file: T | null | false): T {
  if (file === null || file === false) {
    throw new NotFoundError('That file is no longer in the Tree’s files.')
  }

  return file
}

const GONE_FROM_LIBRARY = 'That System prompt is no longer in the library.'

function publishLibrary(
  systemPrompts: SystemPrompts,
  publish: HandlerDeps['publish']
) {
  publish({type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: systemPrompts.list()})
}

export const handlers: Handlers = {
  'app.ping': ({nonce}, {now}) => ({nonce, receivedAt: now().toISOString()}),

  'tree.create': (_command, {now, trees, systemPrompts, settings, publish}) => {
    const tree = trees.create(
      now(),
      systemPrompts.defaultText(),
      settings.read().toolDefaults
    )

    publish({type: 'TREE_CREATED', tree})

    return tree
  },

  'tree.list': (_command, {trees}) => ({trees: trees.list()}),

  'tree.open': ({treeId}, {trees, publish}) => {
    const seen = trees.markSeen(treeId)

    if (seen?.changed) publish({type: 'TREE_CHANGED', tree: seen.tree})

    return found(seen?.tree ?? null)
  },

  'tree.rename': ({treeId, title}, {trees, publish}) => {
    const tree = found(trees.rename(treeId, title))
    publish({type: 'TREE_CHANGED', tree})

    return tree
  },

  'tree.delete': ({treeId}, {trees, turns, publish}) => {
    found(trees.get(treeId))
    turns.stopAll(treeId)
    trees.delete(treeId)
    publish({type: 'TREE_DELETED', treeId})

    return {}
  },

  'tree.set-system-prompt': ({treeId, text}, {trees, publish}) => {
    const tree = found(trees.setSystemPrompt(treeId, text))
    publish({type: 'TREE_CHANGED', tree})

    return tree
  },

  'tree.set-tools': ({treeId, changes}, {trees, publish}) => {
    const tree = found(trees.setTools(treeId, changes))
    publish({type: 'TREE_CHANGED', tree})

    return tree
  },

  'tree.turns': async ({treeId}, {trees, turns, treeFiles, attachments}) => {
    found(trees.get(treeId))

    const {prompts, replies} = turns.list(treeId)

    return {
      prompts: await attachments.withMissingCopies(prompts),
      replies: await treeFiles.withChangedFiles(treeId, replies),
    }
  },

  'prompt.send': async (command, {trees, turns, attachments}) => {
    found(trees.get(command.treeId))

    const sent = turns.sendPrompt(command)

    if (!sent) throw new NotFoundError(REPLY_GONE)

    const [prompt = sent.prompt] = await attachments.withMissingCopies([
      sent.prompt,
    ])

    return {...sent, prompt}
  },

  'prompt.delete': ({treeId, promptId}, {trees, turns}) => {
    found(trees.get(treeId))

    const deleted = turns.deletePrompt(treeId, promptId)

    if (!deleted) throw new NotFoundError('That Prompt no longer exists.')

    return deleted
  },

  'reply.stop': ({treeId, replyId}, {turns}) => {
    turns.stop(treeId, replyId)

    return {}
  },

  'reply.answer-approval': (command, {turns}) => {
    if (!turns.answerApproval(command)) {
      throw new NotFoundError('That Approval card is no longer waiting.')
    }

    return {}
  },

  'reply.retry': ({treeId, replyId}, {trees, turns}) => {
    found(trees.get(treeId))

    const reply = turns.retry(treeId, replyId)

    if (!reply) throw new NotFoundError(REPLY_GONE)

    return {reply}
  },

  'provider.connect': ({provider}, {connections}) => {
    connections.connect(provider)

    return {}
  },

  'sign-in.open-page': ({provider}, {connections}) => {
    connections.openPage(provider)

    return {}
  },

  'sign-in.code': ({provider, code}, {connections}) => {
    connections.submitCode(provider, code)

    return {}
  },

  'sign-in.cancel': ({provider}, {connections}) => {
    connections.cancel(provider)

    return {}
  },

  'image.load': async ({url}, {images}) => images.load(url),

  'attachment.add': async ({file, shrunk}, {attachments}) => ({
    attachment: await attachments.add(file, shrunk),
  }),

  'settings.update': ({changes}, {settings, publish}) => {
    const saved = settings.update(changes)
    publish({type: 'SETTINGS_CHANGED', settings: saved})

    return saved
  },

  'system-prompt.create': ({name, text}, {now, systemPrompts, publish}) => {
    const entry = systemPrompts.create({name, text}, now())
    publishLibrary(systemPrompts, publish)

    return entry
  },

  'system-prompt.update': ({id, name, text}, {systemPrompts, publish}) => {
    const entry = systemPrompts.update(id, {name, text})

    if (!entry) throw new NotFoundError(GONE_FROM_LIBRARY)

    publishLibrary(systemPrompts, publish)

    return entry
  },

  'system-prompt.delete': ({id}, {systemPrompts, publish}) => {
    const deleted = systemPrompts.delete(id)

    if (!deleted) throw new NotFoundError(GONE_FROM_LIBRARY)

    publishLibrary(systemPrompts, publish)

    if (deleted.settings) {
      publish({type: 'SETTINGS_CHANGED', settings: deleted.settings})
    }

    return {}
  },

  'layout.update': ({changes}, {layout, publish}) => {
    const saved = layout.update(changes)
    publish({type: 'LAYOUT_CHANGED', layout: saved})

    return saved
  },

  'snapshots.download-again': (_command, {downloadGitAgain}) => {
    downloadGitAgain()

    return {}
  },

  'tree-files.list': async ({treeId, replyId}, {trees, treeFiles}) => {
    found(trees.get(treeId))

    return replyFound(await treeFiles.listFiles(treeId, replyId))
  },

  'tree-files.save-copy': async ({treeId, replyId}, {trees, treeFiles}) => {
    found(trees.get(treeId))

    return replyFound(await treeFiles.saveFilesCopy(treeId, replyId))
  },

  'tree-file.describe': async ({fileId}, {treeFiles}) =>
    fileFound(await treeFiles.describeFile(fileId)),

  'tree-file.open': async ({fileId, with: how}, {treeFiles}) => {
    fileFound(await treeFiles.openFile(fileId, how))

    return {}
  },

  'tree-file.reveal': async ({fileId}, {treeFiles}) => {
    fileFound(await treeFiles.revealFile(fileId))

    return {}
  },

  'tree-file.save-copy': async ({fileId}, {treeFiles}) =>
    fileFound(await treeFiles.saveFileCopy(fileId)),

  'tree-file.thumbnail': async ({fileId}, {treeFiles}) =>
    fileFound(await treeFiles.thumbnail(fileId)),
}
