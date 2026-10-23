import {formatTokens} from '../format'

interface ContextSizeProps {
  /** The Thread's Context size up to this Reply. */
  contextSize: number
  /**
   * The Thread's Context size before this Exchange: 0 at the root, null when
   * the previous Reply never reported one.
   */
  previousContextSize: number | null
}

/** Signed, since a compaction can shrink the Thread. */
function signed(tokens: number) {
  return tokens < 0 ? `−${formatTokens(-tokens)}` : `+${formatTokens(tokens)}`
}

/**
 * The Context size badge every Reply shows: the Thread's size up to here, and
 * on hover how much this Exchange changed it by. Providers report only the
 * cumulative size, so an Exchange's own size is the difference.
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
          : `This Exchange: ${signed(added)} · Thread up to here: ${formatTokens(contextSize)}`}
      </span>
    </span>
  )
}

interface ContextMeterProps {
  contextSize: number
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
