import type {CanvasOrientation} from '@uz/contract/settings'

import {Button} from '#shadcn/ui/button'
import {Toggle} from '#shadcn/ui/toggle'
import {ToggleGroup, ToggleGroupItem} from '#shadcn/ui/toggle-group'
import {Tooltip, TooltipContent, TooltipTrigger} from '#shadcn/ui/tooltip'
import {CanvasOrientationSchema} from '@uz/contract/settings'
import {useReactFlow} from '@xyflow/react'
import {cn} from 'cn'
import {MapIcon, MinusIcon, PlusIcon, ScanIcon} from 'lucide-react'
import {useRef} from 'react'

import {useReducedMotion} from '../reduced-motion'
import {TooltipButton} from './TooltipButton'

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

const TOOL_CLASS = "size-7 [&_svg:not([class*='size-'])]:size-3.5"

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
      <TooltipButton
        label="Zoom in"
        className={TOOL_CLASS}
        onClick={() => void flow.zoomIn({duration: still ? 0 : 200})}
      >
        <PlusIcon />
      </TooltipButton>
      <TooltipButton
        label="Zoom out"
        className={TOOL_CLASS}
        onClick={() => void flow.zoomOut({duration: still ? 0 : 200})}
      >
        <MinusIcon />
      </TooltipButton>
      <TooltipButton
        label="Fit the whole Tree"
        className={TOOL_CLASS}
        onClick={() =>
          void flow.fitView({
            padding: 0.15,
            maxZoom: 1,
            duration: still ? 0 : 300,
          })
        }
      >
        <ScanIcon />
      </TooltipButton>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Show the minimap"
              size="sm"
              pressed={showMap}
              onPressedChange={() => onToggleMap()}
              className={cn(
                TOOL_CLASS,
                'min-w-7 px-0 aria-pressed:bg-accent aria-pressed:text-accent-foreground'
              )}
            />
          }
        >
          <MapIcon />
        </TooltipTrigger>
        <TooltipContent>Show the minimap</TooltipContent>
      </Tooltip>
      <ToggleGroup
        aria-label="Orientation"
        spacing={0}
        value={[orientation]}
        onValueChange={([next]) => {
          const parsed = CanvasOrientationSchema.safeParse(next)

          if (parsed.success) onOrientation(parsed.data)
        }}
        className="ml-1 rounded-lg bg-muted p-0.5"
      >
        {CanvasOrientationSchema.options.map(value => (
          <ToggleGroupItem
            key={value}
            value={value}
            size="sm"
            className="h-auto min-w-0 rounded-md! px-2 py-1 text-[0.6875rem] font-normal text-muted-foreground hover:bg-transparent aria-pressed:bg-card aria-pressed:text-card-foreground aria-pressed:shadow-sm"
          >
            {LABELS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[0.6875rem]"
            onClick={next}
          />
        }
      >
        <span className={cn('size-2 rounded-full', dotClass)} />
        {label}
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}
