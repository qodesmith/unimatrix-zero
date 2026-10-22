import type {Prompt, Reply} from '@uz/contract/turns'
import type {KeyboardEvent} from 'react'

import {Button} from '#modules/shadcn/main'
import {useState} from 'react'

import {useSendPrompt, useTurns} from '../use-turns'
import {ReplyView} from './ReplyView'

/**
 * One Tree: the centered Input while it's empty, then its Turns, with an
 * Input after the last Reply once it has finished.
 */
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
        <Input treeId={treeId} parentReplyId={null} />
      </div>
    )
  }

  const leaf = replies.at(-1)

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ol className="flex flex-col gap-4">
        {prompts.map(prompt => (
          <Exchange
            key={prompt.id}
            prompt={prompt}
            reply={replies.find(reply => reply.promptId === prompt.id)}
          />
        ))}
      </ol>
      {leaf && leaf.status !== 'streaming' && (
        <Input key={leaf.id} treeId={treeId} parentReplyId={leaf.id} />
      )}
    </div>
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

function Input({
  treeId,
  parentReplyId,
}: {
  treeId: string
  parentReplyId: string | null
}) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)
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
