import {Badge} from '#shadcn/ui/badge'
import {Button} from '#shadcn/ui/button'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'
import {cn} from 'cn'
import {InfoIcon, XIcon} from 'lucide-react'
import {useRef, useState} from 'react'

import {formatTokens} from '../format'
import {TooltipButton} from './TooltipButton'

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
      <Badge
        variant="secondary"
        aria-label={`Context size ${formatTokens(contextSize)}`}
        className="cursor-default rounded-md bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground"
      >
        {formatTokens(contextSize)} ctx
      </Badge>
      <Button
        ref={info}
        variant="ghost"
        size="icon-xs"
        aria-label="Context size details"
        aria-expanded={open}
        className="size-auto rounded-full border-0 text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
        onClick={() => setOpen(!open)}
      >
        <InfoIcon className="size-3.5" />
      </Button>
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
        <TooltipButton label="Close" className="size-6" onClick={onClose}>
          <XIcon />
        </TooltipButton>
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

interface ContextMeterProps {
  contextSize: number
  contextWindow: number
}

export function ContextMeter({contextSize, contextWindow}: ContextMeterProps) {
  const percent = Math.min(100, (contextSize / contextWindow) * 100)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="meter"
            aria-label="Context size toward the Context window"
            aria-valuenow={contextSize}
            aria-valuemin={0}
            aria-valuemax={contextWindow}
            className="h-1 w-full bg-muted"
          />
        }
      >
        <div className="h-full bg-primary" style={{width: `${percent}%`}} />
      </TooltipTrigger>
      <TooltipContent>
        {formatTokens(contextSize)} of {formatTokens(contextWindow)}
      </TooltipContent>
    </Tooltip>
  )
}
