import type {ReadModels} from './models'
import type {ClaudeSignInDeps} from './sign-in'
import type {ClaudeRepliesDeps} from './streaming'
import type {SpawnOptions} from '@anthropic-ai/claude-agent-sdk'
import type {ProviderDriver, SignInRequest} from '@uz/contract/host'

import {idleFor} from '#modules/idle/main'
import {
  macHasDeveloperTools,
  withAppFolders,
} from '#modules/vendor-environment/main'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {getProgramReady} from '@uz/vendor-program'
import {spawn} from 'node:child_process'

import {readAccount} from './account'
import {claudeEnvironment} from './environment'
import {HEARD_WITHIN_MS} from './heard'
import {signOut, startLogin} from './login'
import {createModelList} from './models'
import {runClaudeOneShot} from './one-shot'
import {SIGN_IN_TIMEOUT_MS, createClaudeSignIn} from './sign-in'
import {createClaudeReplies} from './streaming'
import {IDLE_CLOSE_MS, MAX_WARM} from './warm'

/**
 * Claude Code's alias for its current Haiku. The SDK lists Models only from a
 * running `claude`, with no size to rank them by.
 */
const SMALLEST_MODEL = 'haiku'

async function notYet(): Promise<never> {
  throw new Error('Claude can’t do this yet.')
}

export function spawnClaude({command, args, cwd, env, signal}: SpawnOptions) {
  return spawn(command, args, {
    cwd,
    env,
    signal,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
}

function readModelsWith(hostEnv: ClaudeSignInDeps['hostEnv']): ReadModels {
  return async request => {
    const {program, configDir} = request

    if (!program) throw new Error('The manifest names no Claude program.')

    const {models} = await readAccount({
      program: program.path,
      env: claudeEnvironment(await hostEnv(request), configDir),
      cwd: configDir,
    })

    return models
  }
}

type ClaudeDriverOptions = Pick<ClaudeRepliesDeps, 'store'> &
  Partial<
    Omit<
      ClaudeRepliesDeps,
      'store' | 'learnModels' | 'resolveModel' | 'hostEnv'
    >
  > & {
    env?: NodeJS.ProcessEnv
    hasDeveloperTools?: typeof macHasDeveloperTools
  }

export function createClaudeDriver({
  store,
  query: run = query,
  spawn: start = spawnClaude,
  env = process.env,
  platform = process.platform,
  hasDeveloperTools = macHasDeveloperTools,
  whenIdle = idleFor(IDLE_CLOSE_MS),
  maxWarm = MAX_WARM,
  whenSilent = idleFor(HEARD_WITHIN_MS),
}: ClaudeDriverOptions): ProviderDriver {
  // Every `claude` runs `git` as it starts, a one-shot's with no tools too.
  async function hostEnv(vendorProgram: SignInRequest) {
    return withAppFolders(env, vendorProgram, hasDeveloperTools, platform)
  }

  const models = createModelList(readModelsWith(hostEnv))

  const replies = createClaudeReplies({
    store,
    query: run,
    spawn: start,
    hostEnv,
    whenIdle,
    maxWarm,
    whenSilent,
    platform,
    learnModels: models.learn,
    resolveModel: models.resolve,
  })

  return {
    capabilities: {
      pdfAttachments: true,
      skillScriptsInPlainTrees: true,
      mcpOAuth: true,
      sseMcp: true,
      sessionFromTranscript: true,
    },
    ...createClaudeSignIn({
      getProgramReady,
      commandFor: path => ({command: path, args: []}),
      startLogin,
      readAccount,
      signOut,
      learnModels: models.learn,
      hostEnv,
      timeoutMs: SIGN_IN_TIMEOUT_MS,
    }),
    readConnection: notYet,
    listModels: models.list,
    onModelsChanged: models.onChanged,
    smallestModel: async () => SMALLEST_MODEL,
    readUsage: notYet,
    startReply: replies.startReply,
    stop: replies.stop,
    answerApproval: notYet,
    forkSession: notYet,
    cutSession: replies.cutSession,
    runOneShot: async (request, signal) =>
      runClaudeOneShot(
        {query: run, env: await hostEnv(request.vendorProgram)},
        request,
        signal
      ),
    mcpSignIn: notYet,
  }
}
