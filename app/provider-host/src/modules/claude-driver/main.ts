import type {ReadModels} from './models'
import type {ClaudeRepliesDeps} from './streaming'
import type {SpawnOptions} from '@anthropic-ai/claude-agent-sdk'
import type {ProviderDriver} from '@uz/contract/host'

import {idleFor} from '#modules/idle/main'
import {getProgramReady} from '#modules/vendor-program/main'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {spawn} from 'node:child_process'

import {readAccount} from './account'
import {claudeEnvironment} from './environment'
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

function readModelsIn(env: NodeJS.ProcessEnv): ReadModels {
  return async ({program, configDir}) => {
    if (!program) throw new Error('The manifest names no Claude program.')

    const {models} = await readAccount({
      program: program.path,
      env: claudeEnvironment(env, configDir),
      cwd: configDir,
    })

    return models
  }
}

type ClaudeDriverOptions = Pick<ClaudeRepliesDeps, 'store'> &
  Partial<Omit<ClaudeRepliesDeps, 'store' | 'learnModels' | 'resolveModel'>>

export function createClaudeDriver({
  store,
  query: run = query,
  spawn: start = spawnClaude,
  env = process.env,
  whenIdle = idleFor(IDLE_CLOSE_MS),
  maxWarm = MAX_WARM,
}: ClaudeDriverOptions): ProviderDriver {
  const models = createModelList(readModelsIn(env))

  const replies = createClaudeReplies({
    store,
    query: run,
    spawn: start,
    env,
    whenIdle,
    maxWarm,
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
      env,
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
    rebuildSession: notYet,
    cutSession: replies.cutSession,
    runOneShot: async (request, signal) =>
      runClaudeOneShot({query: run, env}, request, signal),
    mcpSignIn: notYet,
  }
}
