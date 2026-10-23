import type {Turns} from '#modules/turns/main'
import type {CanvasState} from '../canvas-context'
import type {Focus} from './Flow'
import type {CanvasOrientation} from '@uz/contract/settings'

import {useSettings, useUpdateSettings} from '#modules/settings/main'
import {useTurns} from '#modules/turns/main'
import {ReactFlowProvider} from '@xyflow/react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {CanvasContext} from '../canvas-context'
import {indexTurns, isEmpty, newestReply, pathTo} from '../tree'
import {Flow} from './Flow'
import {PromptInput} from './PromptInput'

/** How long Turns take to glide to their places in the other orientation. */
const SWITCH_MS = 400

/** The set with one id added when it was out, or taken out when it was in. */
function toggled(id: string) {
  return (current: ReadonlySet<string>) => {
    const next = new Set(current)

    if (!next.delete(id)) next.add(id)

    return next
  }
}

/** One Tree on the canvas: a centered Input while it is empty, then its Turns. */
export function Canvas({treeId}: {treeId: string}) {
  const turns = useTurns(treeId)

  if (turns.isPending) return null

  if (turns.isError) {
    return <p className="p-6 text-sm text-destructive">{turns.error.message}</p>
  }

  return <TreeCanvas treeId={treeId} turns={turns.data} />
}

function TreeCanvas({treeId, turns}: {treeId: string; turns: Turns}) {
  const index = useMemo(() => indexTurns(turns), [turns])
  const settings = useSettings()
  const {canvasOrientation, limitTurnHeight, contextSizeMeter} = settings
  const updateSettings = useUpdateSettings()
  // oxlint-disable-next-line react/hook-use-state -- a Tree that starts here keeps its zoom instead of fitting
  const [startedEmpty] = useState(() => isEmpty(index))
  const [chosenReplyId, setChosenReplyId] = useState<string | null>(null)
  const [hoverTurnId, setHoverTurnId] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [switching, setSwitching] = useState(false)

  const [expandedTurnIds, setExpandedTurnIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const [collapsedReplyIds, setCollapsedReplyIds] = useState<
    ReadonlySet<string>
  >(() => new Set())

  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (switchTimer.current) clearTimeout(switchTimer.current)
    },
    []
  )

  const activeReplyId =
    chosenReplyId !== null && index.replyById.has(chosenReplyId)
      ? chosenReplyId
      : (newestReply(index)?.id ?? null)

  // Hovering redraws the highlight only while the pointer is on the Turn.
  const highlightedTurnId = hoverTurnId ?? activeReplyId

  const thread = useMemo(
    () => new Set(highlightedTurnId ? pathTo(index, highlightedTurnId) : []),
    [index, highlightedTurnId]
  )

  const focusOn = useCallback((replyId: string) => {
    setFocus(current => ({
      replyId,
      sequence: (current?.sequence ?? 0) + 1,
    }))
  }, [])

  const toggleExpanded = useCallback((turnId: string) => {
    setExpandedTurnIds(toggled(turnId))
  }, [])

  const toggleCollapsed = useCallback((replyId: string) => {
    setCollapsedReplyIds(toggled(replyId))
  }, [])

  const onSent = useCallback(
    (replyId: string) => {
      setChosenReplyId(replyId)
      focusOn(replyId)
    },
    [focusOn]
  )

  function onOrientation(orientation: CanvasOrientation) {
    if (orientation === canvasOrientation) return

    void updateSettings({canvasOrientation: orientation})
    setSwitching(true)

    if (switchTimer.current) clearTimeout(switchTimer.current)

    switchTimer.current = setTimeout(() => setSwitching(false), SWITCH_MS)

    if (activeReplyId) focusOn(activeReplyId)
  }

  const state = useMemo<CanvasState>(
    () => ({
      treeId,
      index,
      activeReplyId,
      setActiveReplyId: setChosenReplyId,
      onSent,
      expandedTurnIds,
      toggleExpanded,
      collapsedReplyIds,
      toggleCollapsed,
      limitTurnHeight,
      contextSizeMeter,
    }),
    [
      treeId,
      index,
      activeReplyId,
      onSent,
      expandedTurnIds,
      toggleExpanded,
      collapsedReplyIds,
      toggleCollapsed,
      limitTurnHeight,
      contextSizeMeter,
    ]
  )

  if (isEmpty(index)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-xl">
          <PromptInput treeId={treeId} parentReplyId={null} onSent={onSent} />
        </div>
      </div>
    )
  }

  return (
    <CanvasContext value={state}>
      <ReactFlowProvider>
        <Flow
          index={index}
          orientation={canvasOrientation}
          thread={thread}
          collapsedReplyIds={collapsedReplyIds}
          focus={focus}
          fitOnLoad={!startedEmpty}
          switching={switching}
          onHover={setHoverTurnId}
          onOrientation={onOrientation}
          onJump={focusOn}
        />
      </ReactFlowProvider>
    </CanvasContext>
  )
}
