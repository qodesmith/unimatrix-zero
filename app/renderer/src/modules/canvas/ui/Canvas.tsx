import type {Turns} from '#modules/turns/main'
import type {CanvasState, Collapsed, Expanded} from '../canvas-context'
import type {TreeIndex} from '../tree'
import type {Focus} from './Flow'
import type {CanvasOrientation} from '@uz/contract/settings'
import type {Viewport} from '@xyflow/react'
import type {ReactNode} from 'react'

import {useSettings, useUpdateSettings} from '#modules/settings/main'
import {useTurns} from '#modules/turns/main'
import {Alert, AlertDescription} from '#shadcn/ui/alert'
import {ReactFlowProvider} from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {CanvasContext} from '../canvas-context'
import {useChatSlideout} from '../chat-slideout/use-chat-slideout'
import {useDeletion} from '../deletion'
import {useEscapeStops} from '../escape-stops'
import {TURN_WIDTH} from '../layout'
import {indexTurns, isEmpty, pathTo, previousReply} from '../tree'
import {CanvasControls} from './CanvasControls'
import {ChatSlideout} from './ChatSlideout'
import {Flow} from './Flow'
import {PromptInput} from './PromptInput'

/** The length of `.canvas-switching`'s transform transition in styles.css. */
const SWITCH_MS = 400

function toggled(id: string) {
  return (current: ReadonlySet<string>) => {
    const next = new Set(current)

    if (!next.delete(id)) next.add(id)

    return next
  }
}

/** Unfolds the Forks over a Turn; the topmost, still on screen, keeps its place. */
function unfoldedOver(index: TreeIndex, replyId: string) {
  return (current: Collapsed): Collapsed => {
    const folded = pathTo(index, replyId).filter(id => current.ids.has(id))
    const [topmost] = folded

    if (topmost === undefined) return current

    const ids = new Set(current.ids)

    for (const id of folded) ids.delete(id)

    return {ids, toggledReplyId: topmost}
  }
}

interface EmptyTreeProps {
  treeId: string
  /**
   * Where the Input sits on the canvas, and its width as a share of a Turn's,
   * each time that changes.
   */
  onPlaced: (at: Viewport) => void
  onSent: (replyId: string) => void
}

/** One centered Input, a Turn wide, so the root Prompt can take its place. */
function EmptyTree({treeId, onPlaced, onSent}: EmptyTreeProps) {
  const pane = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const outer = pane.current
    const inner = box.current

    if (!outer || !inner) return undefined

    const observer = new ResizeObserver(() => {
      const from = outer.getBoundingClientRect()
      const to = inner.getBoundingClientRect()
      onPlaced({
        x: to.left - from.left,
        y: to.top - from.top,
        zoom: Math.min(1, to.width / TURN_WIDTH),
      })
    })

    observer.observe(outer)
    observer.observe(inner)

    return () => observer.disconnect()
  }, [onPlaced])

  return (
    <div ref={pane} className="flex h-full items-center justify-center p-6">
      <div ref={box} className="max-w-full" style={{width: TURN_WIDTH}}>
        <PromptInput treeId={treeId} parentReplyId={null} onSent={onSent} />
      </div>
    </div>
  )
}

interface CanvasFrameProps {
  title: ReactNode
  controls?: ReactNode
  children?: ReactNode
}

/** The Tree's name with the canvas controls beside it, over the canvas. */
function CanvasFrame({title, controls, children}: CanvasFrameProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {title}
        </h2>
        {controls}
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}

interface CanvasProps {
  treeId: string
  /** The Tree's name, drawn in the row the controls share. */
  title: ReactNode
}

/** One Tree on the canvas: a centered Input while it is empty, then its Turns. */
export function Canvas({treeId, title}: CanvasProps) {
  const turns = useTurns(treeId)

  if (turns.isPending) return <CanvasFrame title={title} />

  if (turns.isError) {
    return (
      <CanvasFrame title={title}>
        <Alert variant="destructive" className="m-6 w-auto">
          <AlertDescription>{turns.error.message}</AlertDescription>
        </Alert>
      </CanvasFrame>
    )
  }

  return <TreeCanvas treeId={treeId} title={title} turns={turns.data} />
}

interface TreeCanvasProps extends CanvasProps {
  turns: Turns
}

function TreeCanvas({treeId, title, turns}: TreeCanvasProps) {
  const index = useMemo(() => indexTurns(turns), [turns])
  const settings = useSettings()
  const {canvasOrientation, limitTurnHeight, contextSizeMeter} = settings
  const updateSettings = useUpdateSettings()
  // oxlint-disable-next-line react/hook-use-state -- a Tree that starts here keeps its zoom instead of fitting
  const [startedEmpty] = useState(() => isEmpty(index))
  const [chosenReplyId, setChosenReplyId] = useState<string | null>(null)

  const {
    turnId: chatTurnId,
    end: chatEnd,
    open: chatOpen,
    openAt: openChat,
    dismiss: closeChat,
    slidOut: chatClosed,
    follow: followFromChat,
  } = useChatSlideout(index)

  const [hoverTurnId, setHoverTurnId] = useState<string | null>(null)
  const [inputToFocus, setInputToFocus] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [switching, setSwitching] = useState(false)
  const [inputAt, setInputAt] = useState<Viewport | null>(null)
  const [showMap, setShowMap] = useState(false)

  const [expanded, setExpanded] = useState<Expanded>(() => ({
    ids: new Set(),
    toggledTurnId: null,
  }))

  const [collapsed, setCollapsed] = useState<Collapsed>(() => ({
    ids: new Set(),
    toggledReplyId: null,
  }))

  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  )

  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (switchTimer.current) clearTimeout(switchTimer.current)
    },
    []
  )

  const {deleted, activeReplyId, onDeleteConfirmed} = useDeletion(
    index,
    chosenReplyId
  )

  useEscapeStops({treeId, index, activeReplyId, chatOpen, chatEnd})

  // A box deleted under the pointer never says the pointer left it.
  const hoveredTurnId =
    hoverTurnId !== null && pathTo(index, hoverTurnId).length > 0
      ? hoverTurnId
      : null

  const highlightedTurnId =
    hoveredTurnId ?? (chatOpen ? chatEnd?.id : null) ?? activeReplyId

  const thread = useMemo(
    () => new Set(highlightedTurnId ? pathTo(index, highlightedTurnId) : []),
    [index, highlightedTurnId]
  )

  const focusOn = useCallback((replyId: string, mode: Focus['mode']) => {
    setFocus(current => ({
      replyId,
      mode,
      sequence: (current?.sequence ?? 0) + 1,
    }))
  }, [])

  const toggleExpanded = useCallback((turnId: string) => {
    setExpanded(current => ({
      ids: toggled(turnId)(current.ids),
      toggledTurnId: turnId,
    }))
  }, [])

  const toggleCollapsed = useCallback((replyId: string) => {
    setCollapsed(current => ({
      ids: toggled(replyId)(current.ids),
      toggledReplyId: replyId,
    }))
  }, [])

  const setDraft = useCallback((replyId: string, draft: string) => {
    setDrafts(current => {
      const next = new Map(current)

      if (draft === '') next.delete(replyId)
      else next.set(replyId, draft)

      return next
    })
  }, [])

  const onSent = useCallback(
    (replyId: string, parentReplyId: string | null) => {
      setChosenReplyId(replyId)

      if (parentReplyId !== null) {
        setCollapsed(unfoldedOver(index, parentReplyId))
      }

      focusOn(replyId, 'follow')
    },
    [index, focusOn]
  )

  const sentFromInput = useCallback(
    (replyId: string, parentReplyId: string | null) => {
      onSent(replyId, parentReplyId)
      setInputToFocus(replyId)
    },
    [onSent]
  )

  const onInputFocus = useCallback(
    (replyId: string) => {
      setChosenReplyId(replyId)
      setInputToFocus(null)
      closeChat()
    },
    [closeChat]
  )

  const sentFromChat = useCallback(
    (replyId: string) => {
      if (chatEnd) onSent(replyId, chatEnd.id)

      followFromChat(replyId)
    },
    [chatEnd, onSent, followFromChat]
  )

  const jumpTo = useCallback(
    (replyId: string) => {
      const reply = index.replyById.get(replyId)
      const parent = reply ? previousReply(index, reply) : null

      if (parent) setCollapsed(unfoldedOver(index, parent.id))

      focusOn(replyId, 'center')
    },
    [index, focusOn]
  )

  function onOrientation(orientation: CanvasOrientation) {
    if (orientation === canvasOrientation) return

    void updateSettings({canvasOrientation: orientation})
    setSwitching(true)

    if (switchTimer.current) clearTimeout(switchTimer.current)

    switchTimer.current = setTimeout(() => setSwitching(false), SWITCH_MS)

    if (activeReplyId) focusOn(activeReplyId, 'center')
  }

  const state = useMemo<CanvasState>(
    () => ({
      treeId,
      index,
      activeReplyId,
      onInputFocus,
      onSent: sentFromInput,
      inputToFocus,
      onDeleteConfirmed,
      openChat,
      expandedTurnIds: expanded.ids,
      toggleExpanded,
      collapsedReplyIds: collapsed.ids,
      toggleCollapsed,
      drafts,
      setDraft,
      limitTurnHeight,
      contextSizeMeter,
    }),
    [
      treeId,
      index,
      activeReplyId,
      onInputFocus,
      sentFromInput,
      inputToFocus,
      onDeleteConfirmed,
      openChat,
      expanded.ids,
      toggleExpanded,
      collapsed.ids,
      toggleCollapsed,
      drafts,
      setDraft,
      limitTurnHeight,
      contextSizeMeter,
    ]
  )

  if (isEmpty(index)) {
    return (
      <CanvasFrame title={title}>
        <EmptyTree
          treeId={treeId}
          onPlaced={setInputAt}
          onSent={replyId => sentFromInput(replyId, null)}
        />
      </CanvasFrame>
    )
  }

  const streaming = index.replies
    .filter(reply => reply.status === 'streaming')
    .map(reply => reply.id)

  const failed = index.replies
    .filter(reply => reply.status === 'failed')
    .map(reply => reply.id)

  return (
    <CanvasContext value={state}>
      <ReactFlowProvider>
        <CanvasFrame
          title={title}
          controls={
            <CanvasControls
              orientation={canvasOrientation}
              onOrientation={onOrientation}
              streaming={streaming}
              failed={failed}
              onJump={jumpTo}
              showMap={showMap}
              onToggleMap={() => setShowMap(shown => !shown)}
            />
          }
        >
          <Flow
            index={index}
            orientation={canvasOrientation}
            thread={thread}
            collapsed={collapsed}
            expanded={expanded}
            focus={focus}
            fitOnLoad={!startedEmpty}
            startAt={inputAt}
            deleted={deleted}
            switching={switching}
            showMap={showMap}
            onHover={setHoverTurnId}
          />
          {chatTurnId !== null && chatEnd && (
            <ChatSlideout
              end={chatEnd}
              scrollToTurnId={chatTurnId}
              open={chatOpen}
              onClose={closeChat}
              onClosed={chatClosed}
              onFocus={setChosenReplyId}
              onSent={sentFromChat}
            />
          )}
        </CanvasFrame>
      </ReactFlowProvider>
    </CanvasContext>
  )
}
