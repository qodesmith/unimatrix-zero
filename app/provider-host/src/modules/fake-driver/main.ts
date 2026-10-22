import type {ProviderDriver, ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {randomUUID} from 'node:crypto'

import {createFakeSignIn} from './sign-in'

const OPENING = `Here is a **canned** Reply from the fake Provider. It streams word by word, the way a real one would, so the whole path from the Provider host to the window can be tried without an account.

Let me look something up first.

`

const CLOSING = `Found it. A few things worth knowing:

- Every word you see was saved by main before it reached this window.
- Reloading mid-stream picks up exactly where the Reply was.
- A Prompt containing \`/fail\` fails partway; \`/hang\` stops sending until the Reply is stopped.

\`\`\`ts
const answer = 42
\`\`\`

That's the end of the fake Reply.`

/** How many words a `/fail` or `/hang` Reply writes before it misbehaves. */
const WORDS_BEFORE_TROUBLE = 12

/** Words with the whitespace after them, so the deltas join back exactly. */
function words(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}

async function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    // A zero-delay timer still waits ~15ms on Windows, once per word.
    if (ms === 0 || signal.aborted) {
      resolve()

      return
    }

    const timer = setTimeout(done, ms)

    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }

    signal.addEventListener('abort', done)
  })
}

type Behavior = 'complete' | 'fail' | 'hang'

function behaviorOf(prompt: string): Behavior {
  if (prompt.includes('/fail')) return 'fail'

  if (prompt.includes('/hang')) return 'hang'

  return 'complete'
}

interface FakeDriverOptions {
  /** The pause before each word, and between connect steps. */
  delayMs?: number
  /** When the fake sign-in page answers by itself; null: never. */
  signInAnswerMs?: number | null
}

/**
 * A driver with no vendor behind it: canned Markdown with a tool call in the
 * middle, streamed with delays. A Prompt containing `/fail` or `/hang` makes
 * the Reply fail or go quiet partway through. Connecting goes through every
 * step without an account.
 */
export function createFakeDriver({
  delayMs = 40,
  signInAnswerMs = 3000,
}: FakeDriverOptions = {}): ProviderDriver {
  const running = new Map<string, AbortController>()

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent> {
    const {treeId, replyId} = request
    const ids = {treeId, replyId}
    const controller = new AbortController()
    const {signal} = controller
    const behavior = behaviorOf(request.prompt.text)
    let written = 0

    running.set(replyId, controller)

    function stopped(): ReplyEvent {
      return {...ids, type: 'RUN_FINISHED', status: 'stopped'}
    }

    /** Streams the words up to `limit`; false when the Reply was stopped. */
    async function* streamText(
      text: string,
      limit?: number
    ): AsyncGenerator<ReplyEvent, boolean> {
      for (const word of words(text).slice(0, limit)) {
        await sleep(delayMs, signal)

        if (signal.aborted) return false

        yield {...ids, type: 'TEXT_DELTA', delta: word}
        written += 1
      }

      return true
    }

    try {
      yield {...ids, type: 'RUN_STARTED'}

      const opened = yield* streamText(
        OPENING,
        behavior === 'complete' ? undefined : WORDS_BEFORE_TROUBLE
      )

      if (!opened) {
        yield stopped()

        return
      }

      if (behavior === 'fail') {
        yield {
          ...ids,
          type: 'RUN_FINISHED',
          status: 'failed',
          failure: {
            code: 'fake-failure',
            message: 'The fake Provider failed on purpose.',
          },
        }

        return
      }

      if (behavior === 'hang') {
        await new Promise(resolve => {
          signal.addEventListener('abort', resolve, {once: true})
        })

        yield stopped()

        return
      }

      const toolCallId = randomUUID()
      const toolCall = {...ids, toolCallId}

      yield {...toolCall, type: 'TOOL_CALL_START', toolName: 'search'}
      yield {
        ...toolCall,
        type: 'TOOL_CALL_ARGS',
        delta: JSON.stringify({query: request.prompt.text.slice(0, 80)}),
      }
      yield {...toolCall, type: 'TOOL_CALL_END'}
      await sleep(delayMs * 10, signal)
      yield {
        ...toolCall,
        type: 'TOOL_RESULT',
        content: 'Three canned results.',
        isError: false,
      }

      if (!(yield* streamText(CLOSING))) {
        yield stopped()

        return
      }

      const inputTokens = words(request.prompt.text).length
      yield {
        ...ids,
        type: 'TOKENS',
        inputTokens,
        outputTokens: written,
        contextSize: inputTokens + written,
      }
      yield {...ids, type: 'RUN_FINISHED', status: 'complete'}
    } finally {
      running.delete(replyId)
    }
  }

  return {
    capabilities: {
      pdfAttachments: true,
      skillScriptsInPlainTrees: true,
      mcpOAuth: true,
      sseMcp: true,
      sessionFromTranscript: true,
    },
    readConnection: async () => ({
      status: 'signed-in',
      account: {email: 'fake@example.com', plan: 'Fake'},
    }),
    listModels: async () => [{id: 'fake', name: 'Fake model'}],
    readUsage: async () => ({windows: []}),
    ...createFakeSignIn({delayMs, answerMs: signInAnswerMs}),
    startReply,
    stop: async replyId => {
      running.get(replyId)?.abort()
    },
    answerApproval: async () => undefined,
    forkSession: async () => ({sessionId: randomUUID(), messageId: null}),
    rebuildSession: async () => ({sessionId: randomUUID(), messageId: null}),
    rewindSession: async () => undefined,
    runOneShot: async () => 'A fake one-shot answer.',
    mcpSignIn: async () => undefined,
  }
}
