import type {WhenIdle} from '#modules/idle/main'
import type {SessionStoreClient} from '#modules/session-store/main'
import type {CodexCommand, SpawnCodex} from './app-server'
import type {ProviderDriver, SignInRequest} from '@uz/contract/host'

import {idleFor} from '#modules/idle/main'
import {
  macHasDeveloperTools,
  withAppFolders,
} from '#modules/vendor-environment/main'
import {getProgramReady, programOf} from '@uz/vendor-program'
import {spawn} from 'node:child_process'
import fs from 'node:fs'

import {startAppServer} from './app-server'
import {codexArgs, codexEnvironment} from './environment'
import {portFree} from './port'
import {SIGN_IN_TIMEOUT_MS, createCodexSignIn} from './sign-in'
import {IDLE_CLOSE_MS, createCodexReplies} from './streaming'

async function notYet(): Promise<never> {
  throw new Error('ChatGPT can’t do this yet.')
}

export function spawnCodex(
  {command, args}: CodexCommand,
  {cwd, env}: {cwd: string; env: Record<string, string>}
) {
  return spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
}

interface CodexDriverOptions {
  store: SessionStoreClient
  spawn?: SpawnCodex
  commandFor?: (path: string) => CodexCommand
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  hasDeveloperTools?: typeof macHasDeveloperTools
  whenIdle?: WhenIdle
  timeoutMs?: number
}

export function createCodexDriver({
  store,
  spawn: start = spawnCodex,
  commandFor = path => ({command: path, args: []}),
  env = process.env,
  platform = process.platform,
  hasDeveloperTools = macHasDeveloperTools,
  whenIdle = idleFor(IDLE_CLOSE_MS),
  timeoutMs = SIGN_IN_TIMEOUT_MS,
}: CodexDriverOptions): ProviderDriver {
  async function open(request: SignInRequest) {
    const {program, configDir} = request

    if (!program) throw new Error('The manifest names no Codex program.')

    fs.mkdirSync(configDir, {recursive: true, mode: 0o700})

    const {command, args} = commandFor(programOf(program))

    const base = await withAppFolders(env, request, hasDeveloperTools, platform)

    return startAppServer(
      start,
      {command, args: [...args, ...codexArgs(platform)]},
      {cwd: configDir, env: codexEnvironment(base, configDir)}
    )
  }

  const replies = createCodexReplies({store, open, whenIdle})

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
    listModels: replies.listModels,
    onModelsChanged: () => undefined,
    smallestModel: async () => null,
    readUsage: notYet,
    startReply: replies.startReply,
    stop: replies.stop,
    answerApproval: notYet,
    forkSession: notYet,
    cutSession: replies.cutSession,
    runOneShot: notYet,
    mcpSignIn: notYet,
  }
}
