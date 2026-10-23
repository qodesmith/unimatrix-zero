import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'
import type {Prompt, Reply, StreamingReply} from '@uz/contract/turns'

import {describe, expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'

import {App} from './App'

const receivedAt = '2026-10-19T12:00:00.000Z'

interface Saved {
  trees?: Tree[]
  prompts?: Prompt[]
  replies?: Reply[]
  /** What main has in progress, for the SNAPSHOT. */
  streaming?: StreamingReply[]
  /** Claude is connected unless this is a first launch. */
  firstLaunch?: boolean
}

const account = {email: 'sam@example.com', plan: 'Max'}

/**
 * Main as the window sees it: answers commands, sends what it saved, and keeps
 * every command it was sent. `publish` stands in for a Provider host's events.
 */
function fakeMain(saved: Saved = {}) {
  const trees = [...(saved.trees ?? [])]
  const prompts = [...(saved.prompts ?? [])]
  const replies = [...(saved.replies ?? [])]
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function answer(command: Command): CommandOutcome<CommandType> {
    if ('provider' in command) return {ok: true, value: {}}

    if (command.type === 'app.ping') {
      return {ok: true, value: {nonce: command.nonce, receivedAt}}
    }

    if (command.type === 'tree.list') {
      return {ok: true, value: {trees: trees.toReversed()}}
    }

    if (command.type === 'image.load') {
      return {ok: true, value: {dataUrl: 'data:image/png;base64,'}}
    }

    if (command.type === 'tree.create') {
      const tree = {id: crypto.randomUUID(), title: null, createdAt: receivedAt}

      trees.push(tree)
      publish({type: 'TREE_CREATED', tree})

      return {ok: true, value: tree}
    }

    const index = trees.findIndex(tree => tree.id === command.treeId)
    const found = trees[index]

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    if (command.type === 'tree.open') return {ok: true, value: found}

    if (command.type === 'tree.turns') {
      const {treeId} = command

      return {
        ok: true,
        value: {
          prompts: prompts.filter(prompt => prompt.treeId === treeId),
          replies: replies.filter(reply => reply.treeId === treeId),
        },
      }
    }

    if (command.type === 'prompt.send') {
      const prompt = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        parentReplyId: command.parentReplyId,
        text: command.text,
        createdAt: receivedAt,
      }

      const reply: Reply = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        promptId: prompt.id,
        provider: 'claude',
        model: 'fake',
        status: 'streaming',
        content: [],
        contextSize: null,
        createdAt: receivedAt,
      }

      prompts.push(prompt)
      replies.push(reply)

      return {ok: true, value: {prompt, reply}}
    }

    const tree = {...found, title: command.title}
    trees[index] = tree
    publish({type: 'TREE_RENAMED', tree})

    return {ok: true, value: tree}
  }

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      return answer(command)
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: saved.streaming ?? [],
        providers: [
          saved.firstLaunch
            ? {provider: 'claude', status: 'not-connected', account: null}
            : {provider: 'claude', status: 'ready', account},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        signIn: null,
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent, replies, publish}
}

/** The ids of the first Reply main started. */
function firstReply(main: ReturnType<typeof fakeMain>) {
  const [reply] = main.replies

  if (!reply) throw new Error('No Reply was started')

  return {treeId: reply.treeId, replyId: reply.id}
}

it('shows the pong main sends back', async () => {
  globalThis.window.uz = fakeMain()
  await render(<App />)
  await page.getByRole('button', {name: 'Ping main'}).click()
  await expect
    .element(page.getByText(/pong · .* · 2026-10-19T12:00:00.000Z/))
    .toBeVisible()
})

it('lists the Trees main has saved', async () => {
  globalThis.window.uz = fakeMain({
    trees: [
      {id: crypto.randomUUID(), title: 'Trip planning', createdAt: receivedAt},
    ],
  })
  await render(<App />)

  await expect
    .element(page.getByRole('button', {name: 'Trip planning'}))
    .toBeVisible()
})

it('creates a Tree and opens it', async () => {
  globalThis.window.uz = fakeMain()
  await render(<App />)
  await expect.element(page.getByText('Start a new Tree')).toBeVisible()

  await page.getByRole('button', {name: 'New Tree'}).click()

  await expect
    .element(page.getByRole('button', {name: 'Untitled Tree'}))
    .toHaveAttribute('aria-current', 'page')
  await expect
    .element(page.getByRole('heading', {name: 'Untitled Tree'}))
    .toBeVisible()
})

it('renames a Tree by double-clicking it', async () => {
  globalThis.window.uz = fakeMain({
    trees: [{id: crypto.randomUUID(), title: 'Draft', createdAt: receivedAt}],
  })
  await render(<App />)

  await page.getByRole('button', {name: 'Draft'}).dblClick()
  await page.getByRole('textbox', {name: 'Tree name'}).fill('Trip planning')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(page.getByRole('button', {name: 'Trip planning'}))
    .toBeVisible()
})

it('leaves the name alone when renaming is abandoned', async () => {
  const main = fakeMain({
    trees: [{id: crypto.randomUUID(), title: 'Draft', createdAt: receivedAt}],
  })

  globalThis.window.uz = main
  await render(<App />)

  await page.getByRole('button', {name: 'Draft'}).click()
  await userEvent.keyboard('{F2}')
  await page.getByRole('textbox', {name: 'Tree name'}).fill('Nope')
  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByRole('button', {name: 'Draft'})).toBeVisible()
  expect(main.sent.map(command => command.type)).not.toContain('tree.rename')
})

it('streams a Reply word by word into an empty Tree', async () => {
  const main = fakeMain()
  globalThis.window.uz = main
  await render(<App />)
  await page.getByRole('button', {name: 'New Tree'}).click()

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Hello?')).toBeVisible()

  const ids = firstReply(main)
  main.publish({...ids, type: 'RUN_STARTED'})
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'Hi '})
  await expect.element(page.getByText('Hi', {exact: true})).toBeVisible()
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'there'})
  await expect.element(page.getByText('Hi there')).toBeVisible()
  await expect.element(page.getByText('Writing…')).toBeVisible()

  main.publish({...ids, type: 'RUN_FINISHED', status: 'complete'})
  await expect.element(page.getByText('Writing…')).not.toBeInTheDocument()
  await expect.element(page.getByText('Hi there')).toBeVisible()
})

it('continues the Thread from its last Reply once that Reply has finished', async () => {
  const main = fakeMain()
  globalThis.window.uz = main
  await render(<App />)
  await page.getByRole('button', {name: 'New Tree'}).click()
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')

  const first = firstReply(main)
  main.publish({...first, type: 'TEXT_DELTA', delta: 'Hi there'})
  await expect.element(page.getByText('Hi there')).toBeVisible()
  await expect
    .element(page.getByRole('textbox', {name: 'Prompt'}))
    .not.toBeInTheDocument()

  main.publish({...first, type: 'RUN_FINISHED', status: 'complete'})
  // As main saved it, for the Turns fetched again after the next send.
  const [saved] = main.replies

  if (!saved) throw new Error('No Reply was started')

  main.replies[0] = {
    ...saved,
    status: 'complete',
    content: [{type: 'text', text: 'Hi there'}],
  }
  await page.getByRole('textbox', {name: 'Prompt'}).fill('And then?')
  await userEvent.keyboard('{Enter}')

  await expect.element(page.getByText('And then?')).toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: null, text: 'Hello?'}),
    expect.objectContaining({parentReplyId: first.replyId, text: 'And then?'}),
  ])

  const [, second] = main.replies

  if (!second) throw new Error('No second Reply was started')

  main.publish({
    treeId: second.treeId,
    replyId: second.id,
    type: 'TEXT_DELTA',
    delta: 'Then the end.',
  })
  await expect.element(page.getByText('Then the end.')).toBeVisible()
  await expect.element(page.getByText('Hi there')).toBeVisible()
})

it('shows a streaming Reply where it was after a reload, and keeps going', async () => {
  const tree = {
    id: crypto.randomUUID(),
    title: 'Mid-stream',
    createdAt: receivedAt,
  }

  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId: tree.id,
    parentReplyId: null,
    text: 'Tell me',
    createdAt: receivedAt,
  }

  const reply: Reply = {
    id: crypto.randomUUID(),
    treeId: tree.id,
    promptId: prompt.id,
    provider: 'claude',
    model: 'fake',
    status: 'streaming',
    // Saved up to a second before the reload.
    content: [{type: 'text', text: 'Once'}],
    contextSize: null,
    createdAt: receivedAt,
  }

  const ids = {treeId: tree.id, replyId: reply.id}

  const main = fakeMain({
    trees: [tree],
    prompts: [prompt],
    replies: [reply],
    streaming: [
      {
        ...ids,
        status: 'streaming',
        content: [{type: 'text', text: 'Once upon a'}],
        contextSize: null,
      },
    ],
  })

  globalThis.window.uz = main
  await render(<App />)

  await page.getByRole('button', {name: 'Mid-stream'}).click()
  await expect.element(page.getByText('Once upon a')).toBeVisible()

  main.publish({...ids, type: 'TEXT_DELTA', delta: ' time'})
  await expect.element(page.getByText('Once upon a time')).toBeVisible()
})

it('shows a failed Reply with the text it had', async () => {
  const main = fakeMain()
  globalThis.window.uz = main
  await render(<App />)
  await page.getByRole('button', {name: 'New Tree'}).click()
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await page.getByRole('button', {name: 'Send'}).click()
  await expect.element(page.getByText('Writing…')).toBeVisible()

  const ids = firstReply(main)
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'Cut off'})
  main.publish({
    ...ids,
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
  })

  await expect.element(page.getByText('This Reply failed.')).toBeVisible()
  await expect.element(page.getByText('Cut off')).toBeVisible()
})

function claudeCard() {
  return page.getByRole('region', {name: 'Claude'})
}

function chatgptCard() {
  return page.getByRole('region', {name: 'ChatGPT'})
}

describe('connecting a Provider', () => {
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

  it('starts on the Connections screen until a Provider is connected', async () => {
    globalThis.window.uz = fakeMain({firstLaunch: true})
    await render(<App />)

    await expect
      .element(
        page.getByRole('heading', {name: 'Connect the AI you already pay for'})
      )
      .toBeVisible()
    await expect
      .element(page.getByText('Pro or Max · by Anthropic'))
      .toBeVisible()
    await expect.element(page.getByText('Any plan · by OpenAI')).toBeVisible()
    await expect
      .element(page.getByRole('button', {name: 'Start chatting →'}))
      .toBeDisabled()
    await expect
      .element(page.getByRole('region', {name: 'Trees'}))
      .not.toBeInTheDocument()
  })

  it('walks Claude’s card through every step, then starts chatting', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await render(<App />)

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    expect(main.sent.at(-1)).toEqual({
      type: 'provider.connect',
      provider: 'claude',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'get-ready',
      progress: {receivedBytes: 24_000_000, totalBytes: 100_000_000},
    })
    await expect
      .element(claudeCard().getByText('Getting Claude ready… 24 of 100 MB'))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', {name: 'Connect ChatGPT'}))
      .toBeDisabled()
    await expect
      .element(page.getByText('You can connect ChatGPT once Claude is done.'))
      .toBeVisible()

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'sign-in-page',
      url,
    })
    await expect
      .element(
        claudeCard().getByText(
          'Claude’s page may say “Claude Code”. That’s normal.'
        )
      )
      .toBeVisible()
    await claudeCard()
      .getByRole('button', {name: 'Don’t see the page? Open it again'})
      .click()
    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.open-page',
      provider: 'claude',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
    })
    await claudeCard().getByRole('textbox', {name: 'Code'}).fill('typo')
    await claudeCard()
      .getByRole('button', {name: 'Connect', exact: true})
      .click()
    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.code',
      provider: 'claude',
      code: 'typo',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
      wrongCode: true,
    })
    await expect
      .element(
        claudeCard().getByText(
          'That code didn’t work. Copy it again from Claude’s page.'
        )
      )
      .toBeVisible()

    main.publish({type: 'SIGN_IN_STEP', provider: 'claude', step: 'check-plan'})
    await expect
      .element(claudeCard().getByText('Checking your plan…'))
      .toBeVisible()

    main.publish({
      type: 'SIGN_IN_FINISHED',
      provider: 'claude',
      outcome: 'connected',
      account,
    })
    main.publish({
      type: 'PROVIDER_STATUS',
      provider: 'claude',
      status: 'ready',
      account,
    })
    await expect.element(claudeCard().getByText('Connected')).toBeVisible()
    await expect
      .element(claudeCard().getByText('sam@example.com'))
      .toBeVisible()
    await expect.element(claudeCard().getByText('Claude Max')).toBeVisible()

    await page.getByRole('button', {name: 'Start chatting →'}).click()
    await expect
      .element(page.getByRole('textbox', {name: 'Prompt'}))
      .toBeVisible()
    expect(main.sent.map(command => command.type)).toContain('tree.create')
  })

  it('waits for the new page after Claude refuses a code', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await render(<App />)

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      wrongCode: true,
    })
    await claudeCard().getByRole('textbox', {name: 'Code'}).fill('another')

    await expect
      .element(claudeCard().getByRole('button', {name: 'Connect', exact: true}))
      .toBeDisabled()
    await expect
      .element(
        claudeCard().getByRole('button', {
          name: 'Don’t see the page? Open it again',
        })
      )
      .not.toBeInTheDocument()

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
      wrongCode: true,
    })
    await expect
      .element(claudeCard().getByRole('button', {name: 'Connect', exact: true}))
      .toBeEnabled()
  })

  it('cancels connecting from the card', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await render(<App />)

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    main.publish({type: 'SIGN_IN_STEP', provider: 'claude', step: 'get-ready'})
    await claudeCard().getByRole('button', {name: 'Cancel'}).click()

    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.cancel',
      provider: 'claude',
    })
  })

  it('shows each failure in plain words with one action', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await render(<App />)

    const failures = [
      {
        reason: 'download-failed',
        line: 'Couldn’t get Claude ready. Check your internet connection and try again.',
        action: 'Try again',
      },
      {
        reason: 'no-answer',
        line: 'Sign-in didn’t finish on Claude’s page. Try again.',
        action: 'Try again',
      },
      {
        reason: 'plan-refused',
        line: 'Unimatrix Zero needs Claude Pro or Max.',
        action: 'Use a different account',
      },
    ] as const

    for (const {reason, line, action} of failures) {
      main.publish({
        type: 'SIGN_IN_STEP',
        provider: 'claude',
        step: 'check-plan',
      })
      main.publish({
        type: 'SIGN_IN_FINISHED',
        provider: 'claude',
        outcome: 'failed',
        failure: {reason, message: 'from the host'},
      })

      await expect
        .element(claudeCard().getByRole('alert'))
        .toHaveTextContent(line)
      await claudeCard().getByRole('button', {name: action}).click()
      expect(main.sent.at(-1)).toEqual({
        type: 'provider.connect',
        provider: 'claude',
      })
    }
  })

  it('says why Codex refused a ChatGPT account, with a different account to try', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await render(<App />)

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'chatgpt',
      step: 'sign-in-page',
      url: 'https://auth.openai.com/oauth/authorize',
    })
    main.publish({
      type: 'SIGN_IN_FINISHED',
      provider: 'chatgpt',
      outcome: 'failed',
      failure: {
        reason: 'plan-refused',
        message: 'Codex is not enabled for your workspace.',
      },
    })

    await expect
      .element(chatgptCard().getByRole('alert'))
      .toHaveTextContent(
        'Codex isn’t turned on for this ChatGPT workspace. Ask its admin, or use a different account.'
      )
    await expect
      .element(
        chatgptCard().getByRole('button', {name: 'Use a different account'})
      )
      .toBeVisible()
  })

  it('shows why main refused to connect', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) =>
        command.type === 'provider.connect'
          ? {
              ok: false,
              error: {
                code: 'handler-failed',
                message: 'ChatGPT can’t be connected in this version yet.',
              },
            }
          : main.send(command)) as Bridge['send'],
    }
    await render(<App />)

    await page.getByRole('button', {name: 'Connect ChatGPT'}).click()

    await expect
      .element(page.getByRole('region', {name: 'ChatGPT'}).getByRole('alert'))
      .toHaveTextContent('ChatGPT can’t be connected in this version yet.')
  })

  it('shows the same cards from the sidebar once connected', async () => {
    globalThis.window.uz = fakeMain()
    await render(<App />)

    await page.getByRole('button', {name: 'Connections'}).click()

    await expect
      .element(page.getByRole('heading', {name: 'Connections'}))
      .toBeVisible()
    await expect
      .element(claudeCard().getByText('sam@example.com'))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', {name: 'Connect ChatGPT'}))
      .toBeEnabled()

    await page.getByRole('button', {name: '← Back to your Tree'}).click()
    await expect
      .element(page.getByRole('button', {name: 'Ping main'}))
      .toBeVisible()
  })
})
