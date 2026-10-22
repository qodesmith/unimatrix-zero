import type {CodexCommand, CodexProcess, SpawnCodex} from './app-server'
import type {RecordedLine} from './replay'

import {spawn} from 'node:child_process'
import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import {createInterface} from 'node:readline'
import {PassThrough} from 'node:stream'

import {CODEX_HOME_STAND_IN, RecordedMessageSchema} from './replay'

const EMAIL = /"email":"[^"]*"/g

const ID =
  /"(chatgptAccountId|accountId|userId|chatgpt_user_id|installationId)":"[^"]*"/g

const MACHINE = /"(serverName|userAgent)":"[^"]*"/g

/**
 * A recording fit to keep in the repo: `CODEX_HOME`, the account's email and
 * ids, and the machine's name replaced by stand-ins.
 */
function scrub(lines: RecordedLine[], codexHome: string) {
  const homes = [fs.realpathSync(codexHome), codexHome].map(home =>
    JSON.stringify(home).slice(1, -1)
  )

  return lines
    .map(line => {
      let text = JSON.stringify(line)

      for (const home of homes)
        text = text.replaceAll(home, CODEX_HOME_STAND_IN)

      return text
        .replaceAll(EMAIL, '"email":"user@example.com"')
        .replaceAll(ID, '"$1":"00000000-0000-4000-8000-000000000000"')
        .replaceAll(MACHINE, '"$1":"stand-in"')
    })
    .map(text => `${text}\n`)
    .join('')
}

/**
 * Spawns the real `codex app-server`, writing what the driver and it
 * exchanged into the next of `files` once it exits: one recording per
 * process.
 */
export function createRecorder(files: string[]) {
  let run = 0

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

    const lines: RecordedLine[] = [{kind: 'start'}]
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
      if (file) fs.writeFileSync(file, scrub(lines, env.CODEX_HOME ?? cwd))

      recorded.emit('exit', code, signal)
    })

    return recorded
  }

  return {spawn: record satisfies SpawnCodex}
}
