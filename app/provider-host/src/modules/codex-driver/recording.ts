import type {CodexCommand, CodexProcess, SpawnCodex} from './app-server'
import type {RecordedLine} from './replay'

import {
  HOME_STAND_IN,
  buildOf,
  claimRecordings,
  tempFolderNames,
} from '#modules/test-recordings/main'
import {spawn} from 'node:child_process'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import {createInterface} from 'node:readline'
import {PassThrough} from 'node:stream'

import {
  CODEX_HOME_STAND_IN,
  RecordedMessageSchema,
  TREES_FOLDER_STAND_IN,
  TREE_FOLDER_STAND_IN,
} from './replay'

const EMAIL = /"email":"[^"]*"/g

const ID =
  /"(chatgptAccountId|accountId|userId|chatgpt_user_id|installationId)":"[^"]*"/g

const MACHINE = /"(serverName|userAgent)":"[^"]*"/g

function escaped(folder: string) {
  return [fs.realpathSync(folder), folder].map(name =>
    JSON.stringify(name).slice(1, -1)
  )
}

interface Recorded {
  treeFolder?: string
  /** The folder of every Tree, which a Supervised thread's `config` names. */
  treesFolder?: string
}

function scrub(
  lines: RecordedLine[],
  codexHome: string,
  {treeFolder, treesFolder}: Recorded
) {
  const homes = escaped(codexHome)
  const trees = treeFolder === undefined ? [] : escaped(treeFolder)
  const roots = treesFolder === undefined ? [] : escaped(treesFolder)

  return lines
    .map(line => {
      let text = JSON.stringify(line)

      for (const home of homes)
        text = text.replaceAll(home, CODEX_HOME_STAND_IN)

      for (const tree of trees)
        text = text.replaceAll(tree, TREE_FOLDER_STAND_IN)

      for (const root of roots)
        text = text.replaceAll(root, TREES_FOLDER_STAND_IN)

      for (const [temp, standIn] of tempFolderNames().paths)
        text = text.replaceAll(temp, standIn)

      for (const home of escaped(os.homedir()))
        text = text.replaceAll(home, HOME_STAND_IN)

      return text
        .replaceAll(os.userInfo().username, 'sam')
        .replaceAll(EMAIL, '"email":"user@example.com"')
        .replaceAll(ID, '"$1":"00000000-0000-4000-8000-000000000000"')
        .replaceAll(MACHINE, '"$1":"stand-in"')
    })
    .map(text => `${text}\n`)
    .join('')
}

/**
 * Records each real `codex app-server` process into the next of `files`,
 * stamped with its build, the Tree's folder as a stand-in a replay fills in.
 * A process that exits after a later recorder claimed its file writes nothing.
 */
export function createRecorder(files: string[], folders: Recorded = {}) {
  let run = 0
  const write = claimRecordings(files)

  function record(
    {command, args}: CodexCommand,
    {cwd, env}: Parameters<SpawnCodex>[1]
  ): CodexProcess {
    const file = files[run++]

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    const lines: RecordedLine[] = [
      {kind: 'start', build: buildOf('codex', command)},
    ]

    const stdin = new PassThrough()
    const stdout = new PassThrough()

    function push(kind: 'in' | 'out', line: string) {
      const message = RecordedMessageSchema.safeParse(JSON.parse(line))

      if (message.success) lines.push({kind, message: message.data})
    }

    createInterface({input: stdin}).on('line', line => push('in', line))
    createInterface({input: child.stdout}).on('line', line => push('out', line))
    stdin.pipe(child.stdin)
    child.stdout.pipe(stdout)
    stdin.on('end', () => lines.push({kind: 'end'}))

    const recorded: CodexProcess = Object.assign(new EventEmitter(), {
      stdin,
      stdout,
      kill: () => child.kill(),
    })

    child.on('error', error => recorded.emit('error', error))
    child.on('exit', (code, signal) => {
      if (file) write(file, scrub(lines, env.CODEX_HOME ?? cwd, folders))

      recorded.emit('exit', code, signal)
    })

    return recorded
  }

  return {spawn: record satisfies SpawnCodex}
}
