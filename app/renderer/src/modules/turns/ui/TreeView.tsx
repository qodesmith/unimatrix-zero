import type {Prompt, Reply, ReplyPart} from '@uz/contract/turns'
import type {KeyboardEvent} from 'react'

import {Button} from '#modules/shadcn/main'
import {useState} from 'react'

import {useLiveReply} from '../use-live-reply'
import {useSendPrompt, useTurns} from '../use-turns'

/** One Tree: the centered Input while it's empty, then its Turns. */
export function TreeView({treeId}: {treeId: string}) {
  const turns = useTurns(treeId)

  if (turns.isPending) return null

  if (turns.isError) {
    return <p className="text-sm text-destructive">{turns.error.message}</p>
  }

  const {prompts, replies} = turns.data

  if (prompts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <PromptInput treeId={treeId} />
      </div>
    )
  }

  return (
    <ol className="flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
      {prompts.map(prompt => (
        <Exchange
          key={prompt.id}
          prompt={prompt}
          reply={replies.find(reply => reply.promptId === prompt.id)}
        />
      ))}
    </ol>
  )
}

function Exchange({prompt, reply}: {prompt: Prompt; reply?: Reply}) {
  return (
    <li className="flex flex-col gap-2">
      <p className="self-end rounded-lg bg-prompt px-3 py-2 text-sm whitespace-pre-wrap text-prompt-foreground">
        {prompt.text}
      </p>
      {reply && <ReplyView reply={reply} />}
    </li>
  )
}

/** Re-renders only when this Reply changes, from the stream or once saved. */
function ReplyView({reply}: {reply: Reply}) {
  const live = useLiveReply(reply.id)
  const {status, content} = live ?? reply

  return (
    <article
      aria-label="Reply"
      aria-busy={status === 'streaming'}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground"
    >
      {content.map((part, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- parts only ever append, so positions are stable
        <ReplyPartView key={index} part={part} />
      ))}
      {status === 'streaming' && (
        <span className="text-xs text-muted-foreground">Writing…</span>
      )}
      {status === 'failed' && (
        <span className="text-xs text-destructive">This Reply failed.</span>
      )}
    </article>
  )
}

function ReplyPartView({part}: {part: ReplyPart}) {
  if (part.type === 'text') {
    return <p className="whitespace-pre-wrap">{part.text}</p>
  }

  return (
    <span className="self-start rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {part.toolName}
      {part.result ? '' : '…'}
    </span>
  )
}

function PromptInput({treeId}: {treeId: string}) {
  const sendPrompt = useSendPrompt(treeId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (sending || draft.trim() === '') return

    setSending(true)
    const refused = await sendPrompt(draft)
    setSending(false)
    setError(refused)

    if (!refused) setDraft('')
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <form
      className="flex w-full max-w-xl flex-col gap-2"
      onSubmit={event => {
        event.preventDefault()
        void send()
      }}
    >
      <textarea
        aria-label="Prompt"
        rows={3}
        placeholder="Ask anything"
        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-destructive">{error}</p>
        <Button type="submit" disabled={sending || draft.trim() === ''}>
          Send
        </Button>
      </div>
    </form>
  )
}
