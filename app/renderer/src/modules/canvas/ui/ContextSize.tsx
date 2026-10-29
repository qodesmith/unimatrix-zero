import {Button, cn} from '#modules/shadcn/main'
import {useRef, useState} from 'react'

import {formatTokens} from '../format'

interface ContextSizeProps {
  contextSize: number
  /** 0 at the root; null when the previous Reply never reported one. */
  previousContextSize: number | null
  contextWindow: number | null
}

/** Signed, since a compaction can shrink the Thread. */
function signed(tokens: number) {
  return tokens < 0 ? `−${formatTokens(-tokens)}` : `+${formatTokens(tokens)}`
}

/**
 * The badge and its details drawer, which with its blur covers the nearest
 * positioned ancestor: the Reply's box.
 */
export function ContextSize({
  contextSize,
  previousContextSize,
  contextWindow,
}: ContextSizeProps) {
  const [open, setOpen] = useState(false)
  const info = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
    info.current?.focus()
  }

  return (
    <>
      <span
        aria-label={`Context size ${formatTokens(contextSize)}`}
        className="cursor-default rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      >
        {formatTokens(contextSize)} ctx
      </span>
      <button
        ref={info}
        type="button"
        aria-label="Context size details"
        aria-expanded={open}
        className="rounded-full text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <InfoIcon />
      </button>
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 z-10 bg-card/40 backdrop-blur-sm transition-[opacity,visibility] ease-out motion-reduce:transition-none',
          !open && 'invisible opacity-0'
        )}
        onClick={close}
      />
      <ContextSizeDrawer
        open={open}
        onClose={close}
        contextSize={contextSize}
        previousContextSize={previousContextSize}
        contextWindow={contextWindow}
      />
    </>
  )
}

/** Hidden by `invisible` after the slide, so a closed drawer takes no focus. */
function ContextSizeDrawer({
  open,
  onClose,
  contextSize,
  previousContextSize,
  contextWindow,
}: ContextSizeProps & {open: boolean; onClose: () => void}) {
  const added =
    previousContextSize === null ? null : contextSize - previousContextSize

  return (
    <aside
      aria-label="Context size details"
      className={cn(
        'absolute inset-y-0 left-0 z-10 w-56 border-r border-border bg-popover text-popover-foreground transition-[translate,visibility] ease-out motion-reduce:transition-none',
        !open && 'invisible -translate-x-full'
      )}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose()
      }}
    >
      <div className="flex items-center justify-between border-b border-border py-1 pr-1 pl-3">
        <h3 className="text-xs text-muted-foreground">Context size</h3>
        <Button
          variant="ghost"
          size="icon"
          title="Close"
          aria-label="Close"
          className="size-6"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-3 py-2 text-xs">
        {added !== null && (
          <>
            <dt className="text-muted-foreground">This Exchange</dt>
            <dd className="font-mono">{signed(added)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Thread up to here</dt>
        <dd className="font-mono">{formatTokens(contextSize)}</dd>
        {contextWindow !== null && (
          <>
            <dt className="text-muted-foreground">Context window</dt>
            <dd className="font-mono">{formatTokens(contextWindow)}</dd>
          </>
        )}
      </dl>
    </aside>
  )
}

function InfoIcon() {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

interface ContextMeterProps {
  contextSize: number
  contextWindow: number
}

export function ContextMeter({contextSize, contextWindow}: ContextMeterProps) {
  const percent = Math.min(100, (contextSize / contextWindow) * 100)

  return (
    <div
      role="meter"
      aria-label="Context size toward the Context window"
      aria-valuenow={contextSize}
      aria-valuemin={0}
      aria-valuemax={contextWindow}
      title={`${formatTokens(contextSize)} of ${formatTokens(contextWindow)}`}
      className="h-1 w-full bg-muted"
    >
      <div className="h-full bg-primary" style={{width: `${percent}%`}} />
    </div>
  )
}
