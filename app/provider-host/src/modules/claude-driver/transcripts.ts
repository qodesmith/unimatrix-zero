import type {SessionStoreClient} from '#modules/session-store/main'
import type {SessionKey, SessionStore} from '@anthropic-ai/claude-agent-sdk'
import type {SessionEntry, SessionFile, SessionFolder} from '@uz/contract/host'

import fs from 'node:fs'
import path from 'node:path'

/** Where the SDK stops a project key and adds a hash of the whole path. */
const KEY_LENGTH = 200

/** The SDK's `djb2`, so a long key matches the one it computes. */
function djb2(text: string) {
  let hash = 0

  for (let index = 0; index < text.length; index++) {
    // oxlint-disable-next-line no-bitwise -- the SDK's own 32-bit hash
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  }

  return Math.abs(hash).toString(36)
}

/** The project key `claude` files a session under in `cwd`, as the SDK does. */
export function projectKeyOf(cwd: string) {
  const real = fs.realpathSync(path.resolve(cwd))

  const normalized =
    process.platform === 'darwin' ? real.normalize('NFC') : real

  const key = normalized.replaceAll(/[^a-zA-Z0-9]/g, '-')

  if (key.length <= KEY_LENGTH) return key

  return `${key.slice(0, KEY_LENGTH)}-${djb2(normalized)}`
}

function keyOf({projectKey, sessionId, subpath}: SessionKey) {
  return subpath === undefined
    ? {projectKey, sessionId}
    : {projectKey, sessionId, subpath}
}

/** The SDK's session store over the app's copy, which outlives `claude`'s own. */
export function appSessionStore(store: SessionStoreClient): SessionStore {
  return {
    append: async (key, entries) => store.append(keyOf(key), entries),
    load: async key => store.load(keyOf(key)),
    listSubkeys: async ({projectKey, sessionId}) =>
      store.listSubkeys({projectKey, sessionId}),
  }
}

type SessionPlace = SessionFolder & {
  configDir: string
}

function sessionFolder({configDir, projectKey, sessionId}: SessionPlace) {
  return path.join(configDir, 'projects', projectKey, sessionId)
}

/** `relative` resolved in `folder`; null when it would land outside it. */
function within(folder: string, relative: string) {
  const target = path.resolve(folder, relative)

  return target.startsWith(`${folder}${path.sep}`) ? target : null
}

function writeEntries(file: string, entries: SessionEntry[]) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})
  fs.writeFileSync(
    file,
    entries.map(entry => `${JSON.stringify(entry)}\n`).join(''),
    {mode: 0o600}
  )
}

function writeSubagent(stem: string, entries: SessionEntry[]) {
  const metadata = entries.filter(entry => entry.type === 'agent_metadata')

  writeEntries(
    `${stem}.jsonl`,
    entries.filter(entry => entry.type !== 'agent_metadata')
  )

  const last = metadata.at(-1)

  if (last) {
    const {type: _type, ...meta} = last
    fs.writeFileSync(`${stem}.meta.json`, JSON.stringify(meta), {mode: 0o600})
  }
}

/**
 * The fallback restore (ADR 0004): a plain write, so the files are new and no
 * cleanup sweep takes them.
 */
export async function writeTranscriptBack(
  store: SessionStoreClient,
  place: SessionPlace
) {
  const {projectKey, sessionId} = place

  const [own, subpaths] = await Promise.all([
    store.load({projectKey, sessionId}),
    store.listSubkeys({projectKey, sessionId}),
  ])

  if (!own) return false

  const folder = sessionFolder(place)

  const subagents = await Promise.all(
    subpaths.flatMap(subpath => {
      const stem = within(folder, subpath)

      return stem === null
        ? []
        : [
            store
              .load({projectKey, sessionId, subpath})
              .then(kept => ({stem, entries: kept ?? []})),
          ]
    })
  )

  writeEntries(`${folder}.jsonl`, own)

  for (const {stem, entries} of subagents) writeSubagent(stem, entries)

  return true
}

const TOOL_RESULTS = 'tool-results'

/** The session's tool result files not saved before, relative to its folder. */
export function readNewToolResults(
  place: SessionPlace,
  saved: ReadonlySet<string>
): SessionFile[] {
  const folder = sessionFolder(place)
  const root = path.join(folder, TOOL_RESULTS)

  if (!fs.existsSync(root)) return []

  return fs
    .readdirSync(root, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile())
    .map(entry =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/')
    )
    .filter(relative => !saved.has(relative))
    .map(relative => ({
      path: relative,
      base64: fs.readFileSync(path.join(folder, relative)).toString('base64'),
    }))
}

export function restoreFiles(place: SessionPlace, files: SessionFile[]) {
  const folder = sessionFolder(place)

  for (const file of files) {
    const target = within(folder, file.path)

    if (!target) continue

    fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700})
    fs.writeFileSync(target, Buffer.from(file.base64, 'base64'), {mode: 0o600})
  }
}
