import type {
  ProviderDriver,
  ReplyRecorded,
  ReplyRequest,
} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {randomUUID} from 'node:crypto'

import {createFakeSignIn} from './sign-in'

const THINKING = `The user wants to see the fake Provider at work. I'll open with a line about the stream, look something up with the search tool, then close with code, math, a diagram and a picture.`

const THINKING_AFTER_TOOL = `The search answered with three results. Time to close with the list, the code, the math, the diagram and the picture.`

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

Compound growth is $$A = P(1 + r)^n$$, or spelled out:

$$
A = P \\left(1 + \\frac{r}{n}\\right)^{nt}
$$

\`\`\`mermaid
flowchart LR
  Prompt --> Host --> Main --> Window
\`\`\`

![The Reply's path, as a picture](https://example.com/fake-reply-path.png)

That's the end of the fake Reply.`

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
  /** Before each word, and between connect steps. */
  delayMs?: number
  /** Null: the fake sign-in page never answers by itself. */
  signInAnswerMs?: number | null
}

/** A driver with no vendor; `/fail` or `/hang` in a Prompt misbehaves. */
export function createFakeDriver({
  delayMs = 40,
  signInAnswerMs = 3000,
}: FakeDriverOptions = {}): ProviderDriver {
  const running = new Map<string, AbortController>()

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<ReplyEvent | ReplyRecorded> {
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

    /** Returns false once the Reply is stopped, having ended it. */
    async function* streamWords(
      type: 'TEXT_DELTA' | 'REASONING_DELTA',
      text: string,
      limit?: number
    ): AsyncGenerator<ReplyEvent, boolean> {
      for (const word of words(text).slice(0, limit)) {
        await sleep(delayMs, signal)

        if (signal.aborted) {
          yield stopped()

          return false
        }

        yield {...ids, type, delta: word}

        if (type === 'TEXT_DELTA') written += 1
      }

      return true
    }

    try {
      yield {...ids, type: 'RUN_STARTED'}

      if (!(yield* streamWords('REASONING_DELTA', THINKING))) return

      const opened = yield* streamWords(
        'TEXT_DELTA',
        OPENING,
        behavior === 'complete' ? undefined : WORDS_BEFORE_TROUBLE
      )

      if (!opened) return

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
        if (!signal.aborted) {
          await new Promise(resolve => {
            signal.addEventListener('abort', resolve, {once: true})
          })
        }

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

      if (!(yield* streamWords('REASONING_DELTA', THINKING_AFTER_TOOL))) return

      if (!(yield* streamWords('TEXT_DELTA', CLOSING))) return

      const inputTokens = words(request.prompt.text).length
      yield {
        ...ids,
        type: 'TOKENS',
        inputTokens,
        outputTokens: written,
        contextSize: inputTokens + written,
        contextWindow: 200_000,
      }
      yield {
        ...ids,
        type: 'REPLY_RECORDED',
        model: 'fake',
        session: {
          sessionId:
            request.session && !request.session.fork
              ? request.session.sessionId
              : randomUUID(),
          messageId: randomUUID(),
        },
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
