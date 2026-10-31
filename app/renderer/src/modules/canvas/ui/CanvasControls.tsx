import type {CanvasOrientation} from '@uz/contract/settings'
import type {ReactNode} from 'react'

import {Button} from '#shadcn/ui/button'
import {CanvasOrientationSchema} from '@uz/contract/settings'
import {useReactFlow} from '@xyflow/react'
import {cn} from 'cn'
import {MapIcon, MinusIcon, PlusIcon, ScanIcon} from 'lucide-react'
import {useRef} from 'react'

import {useReducedMotion} from '../reduced-motion'

interface CanvasControlsProps {
  orientation: CanvasOrientation
  onOrientation: (orientation: CanvasOrientation) => void
  /** Replies being written, oldest first. */
  streaming: string[]
  /** Replies that failed, oldest first. */
  failed: string[]
  onJump: (replyId: string) => void
  showMap: boolean
  onToggleMap: () => void
}

const LABELS: Record<CanvasOrientation, string> = {
  vertical: 'Vertical',
  horizontal: 'Horizontal',
}

/**
 * One row beside the Tree's name, off the canvas so it never covers a Turn.
 * The orientation toggle is a shortcut to the Setting.
 */
export function CanvasControls({
  orientation,
  onOrientation,
  streaming,
  failed,
  onJump,
  showMap,
  onToggleMap,
}: CanvasControlsProps) {
  const flow = useReactFlow()
  const still = useReducedMotion()

  return (
    <div className="flex shrink-0 items-center gap-1 text-[0.6875rem]">
      {(streaming.length > 0 || failed.length > 0) && (
        <div role="status" className="flex items-center gap-1">
          {streaming.length > 0 && (
            <JumpButton
              label={`${streaming.length} streaming`}
              title="Jump to the next streaming Reply"
              ids={streaming}
              onJump={onJump}
              dotClass="bg-primary"
            />
          )}
          {failed.length > 0 && (
            <JumpButton
              label={`${failed.length} failed`}
              title="Jump to the next failed Reply"
              ids={failed}
              onJump={onJump}
              dotClass="bg-destructive"
            />
          )}
        </div>
      )}
      <ToolButton
        title="Zoom in"
        onClick={() => void flow.zoomIn({duration: still ? 0 : 200})}
      >
        <PlusIcon />
      </ToolButton>
      <ToolButton
        title="Zoom out"
        onClick={() => void flow.zoomOut({duration: still ? 0 : 200})}
      >
        <MinusIcon />
      </ToolButton>
      <ToolButton
        title="Fit the whole Tree"
        onClick={() =>
          void flow.fitView({
            padding: 0.15,
            maxZoom: 1,
            duration: still ? 0 : 300,
          })
        }
      >
        <ScanIcon />
      </ToolButton>
      <ToolButton
        title="Show the minimap"
        pressed={showMap}
        onClick={onToggleMap}
      >
        <MapIcon />
      </ToolButton>
      <div
        role="group"
        aria-label="Orientation"
        className="ml-1 flex rounded-lg bg-muted p-0.5"
      >
        {CanvasOrientationSchema.options.map(value => (
          <Button
            key={value}
            variant="ghost"
            aria-pressed={orientation === value}
            className={cn(
              'h-auto border-0 px-2 py-1 text-[0.6875rem] font-normal',
              orientation === value
                ? 'bg-card text-card-foreground shadow-sm hover:bg-card hover:text-card-foreground dark:hover:bg-card'
                : 'text-muted-foreground hover:bg-transparent dark:hover:bg-transparent'
            )}
            onClick={() => onOrientation(value)}
          >
            {LABELS[value]}
          </Button>
        ))}
      </div>
    </div>
  )
}

interface JumpButtonProps {
  label: string
  title: string
  ids: string[]
  onJump: (replyId: string) => void
  dotClass: string
}

/** Each click pans to the next Reply in the list, round and round. */
function JumpButton({label, title, ids, onJump, dotClass}: JumpButtonProps) {
  const last = useRef<string | null>(null)

  function next() {
    const at = last.current === null ? -1 : ids.indexOf(last.current)
    const id = ids[(at + 1) % ids.length]

    if (id === undefined) return

    last.current = id
    onJump(id)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      title={title}
      className="h-7 gap-1.5 px-2 text-[0.6875rem]"
      onClick={next}
    >
      <span className={cn('size-2 rounded-full', dotClass)} />
      {label}
    </Button>
  )
}

function ToolButton({
  title,
  pressed,
  onClick,
  children,
}: {
  title: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={cn(
        "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        pressed && 'bg-accent text-accent-foreground'
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
