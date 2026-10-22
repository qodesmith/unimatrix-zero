import type {ProviderDriver} from '@uz/contract/host'

import {readAccount} from './account'
import {signOut, startLogin} from './login'
import {getProgramReady} from './program'
import {SIGN_IN_TIMEOUT_MS, createClaudeSignIn} from './sign-in'

async function notYet(): Promise<never> {
  throw new Error('Claude can’t do this yet.')
}

/**
 * Claude through its unmodified vendor program. Connecting works; Replies
 * come later, so it offers no Models yet.
 */
export function createClaudeDriver(): ProviderDriver {
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
      env: process.env,
      timeoutMs: SIGN_IN_TIMEOUT_MS,
    }),
    readConnection: notYet,
    listModels: async () => [],
    readUsage: notYet,
    // oxlint-disable-next-line require-yield -- nothing streams until Replies are built
    async *startReply() {
      await notYet()
    },
    stop: notYet,
    answerApproval: notYet,
    forkSession: notYet,
    rebuildSession: notYet,
    rewindSession: notYet,
    runOneShot: notYet,
    mcpSignIn: notYet,
  }
}
