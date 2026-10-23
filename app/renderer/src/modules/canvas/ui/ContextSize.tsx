import {formatTokens} from '../format'

interface ContextSizeProps {
  /** The Thread's Context size up to this Reply. */
  contextSize: number
  /** The previous Exchange's, so the badge can say how much this one added. */
  previousContextSize: number | null
}

/**
 * The Context size badge every Reply shows: the Thread's size up to here, and
 * on hover how much this Exchange added to it.
 */
export function ContextSizeBadge({
  contextSize,
  previousContextSize,
}: ContextSizeProps) {
  const added =
    previousContextSize === null ? null : contextSize - previousContextSize

  return (
    <span className="group/ctx relative">
      <span
        aria-label={`Context size ${formatTokens(contextSize)}`}
        className="cursor-default rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      >
        {formatTokens(contextSize)} ctx
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-[11px] whitespace-nowrap text-popover-foreground shadow-md group-hover/ctx:block"
      >
        {added === null
          ? `Thread up to here: ${formatTokens(contextSize)}`
          : `This Exchange: +${formatTokens(Math.max(0, added))} · Thread up to here: ${formatTokens(contextSize)}`}
      </span>
    </span>
  )
}

interface ContextMeterProps {
  contextSize: number
  /** The Model's context window. */
  contextWindow: number
}

/** A thin bar along the Reply's bottom edge, filling toward the Model's limit. */
export function ContextMeter({contextSize, contextWindow}: ContextMeterProps) {
  const percent = Math.min(100, (contextSize / contextWindow) * 100)

  return (
    <div
      role="meter"
      aria-label="Context size toward the Model’s limit"
      aria-valuenow={contextSize}
      aria-valuemin={0}
      aria-valuemax={contextWindow}
      title={`${formatTokens(contextSize)} of ${formatTokens(contextWindow)}`}
      className="h-1 w-full overflow-hidden rounded-b-xl bg-muted"
    >
      <div className="h-full bg-primary" style={{width: `${percent}%`}} />
    </div>
  )
}
