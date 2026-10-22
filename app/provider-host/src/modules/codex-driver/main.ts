import type {SessionStoreClient} from '#modules/session-store/main'
import type {CodexCommand, SpawnCodex} from './app-server'
import type {ProviderDriver, SignInRequest} from '@uz/contract/host'

import {getProgramReady, programOf} from '#modules/vendor-program/main'
import {spawn} from 'node:child_process'
import fs from 'node:fs'

import {startAppServer} from './app-server'
import {CODEX_ARGS, codexEnvironment} from './environment'
import {portFree} from './port'
import {SIGN_IN_TIMEOUT_MS, createCodexSignIn} from './sign-in'
import {DEFAULT_MODEL, IDLE_CLOSE_MS, createCodexReplies} from './streaming'

async function notYet(): Promise<never> {
  throw new Error('ChatGPT can’t do this yet.')
}

interface CodexDriverOptions {
  store: SessionStoreClient
  spawn?: SpawnCodex
  /** How to run the program at `path`. */
  commandFor?: (path: string) => CodexCommand
  env?: NodeJS.ProcessEnv
  idleMs?: number
  timeoutMs?: number
}

/**
 * ChatGPT through Codex's unmodified `codex app-server`: connecting, and
 * Replies that stream from it, written by the plan's default Model.
 */
export function createCodexDriver({
  store,
  spawn: start = ({command, args}, {cwd, env}) =>
    spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    }),
  commandFor = path => ({command: path, args: []}),
  env = process.env,
  idleMs = IDLE_CLOSE_MS,
  timeoutMs = SIGN_IN_TIMEOUT_MS,
}: CodexDriverOptions): ProviderDriver {
  async function open({program, configDir}: SignInRequest) {
    if (!program) throw new Error('The manifest names no Codex program.')

    fs.mkdirSync(configDir, {recursive: true, mode: 0o700})

    const {command, args} = commandFor(programOf(program))

    return startAppServer(
      start,
      {command, args: [...args, ...CODEX_ARGS]},
      {cwd: configDir, env: codexEnvironment(env, configDir)}
    )
  }

  const replies = createCodexReplies({store, open, idleMs})

  return {
    capabilities: {
      pdfAttachments: false,
      skillScriptsInPlainTrees: false,
      mcpOAuth: true,
      sseMcp: false,
      sessionFromTranscript: false,
    },
    ...createCodexSignIn({getProgramReady, open, portFree, timeoutMs}),
    readConnection: notYet,
    listModels: async () => [{id: DEFAULT_MODEL, name: 'Default'}],
    readUsage: notYet,
    startReply: replies.startReply,
    stop: notYet,
    answerApproval: notYet,
    forkSession: notYet,
    rebuildSession: notYet,
    rewindSession: notYet,
    runOneShot: notYet,
    mcpSignIn: notYet,
  }
}
