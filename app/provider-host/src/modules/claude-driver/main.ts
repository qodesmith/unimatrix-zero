import type {ClaudeRepliesDeps} from './streaming'
import type {ProviderDriver} from '@uz/contract/host'

import {getProgramReady} from '#modules/vendor-program/main'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {spawn} from 'node:child_process'

import {readAccount} from './account'
import {signOut, startLogin} from './login'
import {SIGN_IN_TIMEOUT_MS, createClaudeSignIn} from './sign-in'
import {DEFAULT_MODEL, createClaudeReplies} from './streaming'
import {IDLE_CLOSE_MS, MAX_WARM} from './warm'

async function notYet(): Promise<never> {
  throw new Error('Claude can’t do this yet.')
}

type ClaudeDriverOptions = Pick<ClaudeRepliesDeps, 'store'> &
  Partial<Omit<ClaudeRepliesDeps, 'store'>>

/** Claude through its unmodified vendor program. */
export function createClaudeDriver({
  store,
  query: run = query,
  spawn: start = ({command, args, cwd, env, signal}) =>
    spawn(command, args, {
      cwd,
      env,
      signal,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    }),
  env = process.env,
  idleMs = IDLE_CLOSE_MS,
  maxWarm = MAX_WARM,
}: ClaudeDriverOptions): ProviderDriver {
  const replies = createClaudeReplies({
    store,
    query: run,
    spawn: start,
    env,
    idleMs,
    maxWarm,
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
      env,
      timeoutMs: SIGN_IN_TIMEOUT_MS,
    }),
    readConnection: notYet,
    listModels: async () => [{id: DEFAULT_MODEL, name: 'Default'}],
    readUsage: notYet,
    startReply: replies.startReply,
    stop: replies.stop,
    answerApproval: notYet,
    forkSession: notYet,
    rebuildSession: notYet,
    rewindSession: notYet,
    runOneShot: notYet,
    mcpSignIn: notYet,
  }
}
