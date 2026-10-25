import type {CanvasOrientation} from '@uz/contract/settings'
import type {ReactNode} from 'react'

import {Button, cn} from '#modules/shadcn/main'
import {CanvasOrientationSchema} from '@uz/contract/settings'
import {MiniMap, Panel, useReactFlow} from '@xyflow/react'
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
}

const LABELS: Record<CanvasOrientation, string> = {
  vertical: 'Vertical',
  horizontal: 'Horizontal',
}

/**
 * The canvas's one control at bottom-left: what needs attention, the minimap,
 * zoom, and the orientation toggle, which is a shortcut to the Setting.
 */
export function CanvasControls({
  orientation,
  onOrientation,
  streaming,
  failed,
  onJump,
}: CanvasControlsProps) {
  const flow = useReactFlow()
  const still = useReducedMotion()

  return (
    <Panel
      position="bottom-left"
      className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-md"
    >
      {(streaming.length > 0 || failed.length > 0) && (
        <div
          role="status"
          className="flex items-center gap-1 border-b border-border p-1 text-[11px]"
        >
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
      <MiniMap
        pannable
        zoomable
        aria-label="Minimap"
        style={{position: 'relative', margin: 0, width: 220, height: 130}}
      />
      <div className="flex items-center gap-1 border-t border-border p-1.5">
        <ToolButton
          title="Zoom in"
          onClick={() => void flow.zoomIn({duration: still ? 0 : 200})}
        >
          +
        </ToolButton>
        <ToolButton
          title="Zoom out"
          onClick={() => void flow.zoomOut({duration: still ? 0 : 200})}
        >
          −
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
          ⤢
        </ToolButton>
        <span className="flex-1" />
        <div
          role="group"
          aria-label="Orientation"
          className="flex rounded-lg bg-muted p-0.5 text-[11px]"
        >
          {CanvasOrientationSchema.options.map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={orientation === value}
              className={cn(
                'rounded-md px-2 py-1',
                orientation === value
                  ? 'bg-card text-card-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => onOrientation(value)}
            >
              {LABELS[value]}
            </button>
          ))}
        </div>
      </div>
    </Panel>
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
      className="h-7 gap-1.5 px-2 text-[11px]"
      onClick={next}
    >
      <span className={cn('size-2 rounded-full', dotClass)} />
      {label}
    </Button>
  )
}

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      aria-label={title}
      className="size-7"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
