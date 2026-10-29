import type {PromptDeleteState} from '../prompt-delete/machine'
import type {KeyboardEvent, ReactNode} from 'react'

import {Button, cn} from '#modules/shadcn/main'
import {useEffect, useRef} from 'react'

import {usePromptDelete} from '../prompt-delete/use-prompt-delete'

function TrashIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

interface ConfirmationProps {
  state: Exclude<PromptDeleteState, {status: 'idle'}>
  turnCount: number
  onConfirm: () => void
  onCancel: () => void
}

function Confirmation({
  state,
  turnCount,
  onConfirm,
  onCancel,
}: ConfirmationProps) {
  const cancelButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButton.current?.focus({preventScroll: true})
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return

    event.preventDefault()
    onCancel()
  }

  return (
    <div
      role="group"
      aria-label="Delete this Prompt"
      data-handles-escape
      className="flex max-w-md flex-col gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3 text-xs text-card-foreground shadow-md"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-1.5">
        <p className="mr-1 whitespace-nowrap">
          <span className="font-medium">
            Delete {turnCount} {turnCount === 1 ? 'Turn' : 'Turns'}?
          </span>{' '}
          <span className="text-muted-foreground">This can’t be undone.</span>
        </p>
        <Button
          ref={cancelButton}
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={state.status === 'deleting'}
          onClick={onConfirm}
        >
          {state.status === 'deleting' ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
      {state.status === 'refused' && (
        <p role="alert" className="pr-2 pb-1 text-destructive">
          {state.error}
        </p>
      )}
    </div>
  )
}

interface PromptBoxProps {
  promptId: string
  className: string
  children: ReactNode
}

/**
 * A Prompt's box, with its delete control and confirmation drawn over its
 * top-right corner, so neither shifts anything on the canvas.
 */
export function PromptBox({promptId, className, children}: PromptBoxProps) {
  const {state, offered, turnCount, arm, cancel, confirm} =
    usePromptDelete(promptId)

  const trigger = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  useEffect(() => {
    if (state.status !== 'idle' || !refocus.current) return

    refocus.current = false
    trigger.current?.focus({preventScroll: true})
  }, [state.status])

  function cancelFromConfirmation() {
    refocus.current = true
    cancel()
  }

  return (
    <div
      data-turn={promptId}
      className={cn('group/prompt relative', className)}
      onPointerLeave={cancel}
    >
      {children}
      {offered && (
        <div
          data-delete
          className={cn(
            'absolute top-1 right-1 z-10 transition-opacity',
            state.status === 'idle' &&
              'opacity-0 group-hover/prompt:opacity-100 focus-within:opacity-100'
          )}
        >
          {state.status === 'idle' ? (
            <Button
              ref={trigger}
              variant="ghost"
              size="icon"
              title="Delete this Prompt and everything below it"
              aria-label="Delete this Prompt and everything below it"
              className="size-6 bg-card text-muted-foreground shadow-sm hover:text-destructive"
              onClick={arm}
            >
              <TrashIcon />
            </Button>
          ) : (
            <Confirmation
              state={state}
              turnCount={turnCount}
              onConfirm={confirm}
              onCancel={cancelFromConfirmation}
            />
          )}
        </div>
      )}
    </div>
  )
}
