import type {Turns} from '#modules/turns/main'
import type {CanvasState, Collapsed} from '../canvas-context'
import type {TreeIndex} from '../tree'
import type {Focus} from './Flow'
import type {CanvasOrientation} from '@uz/contract/settings'

import {useSettings, useUpdateSettings} from '#modules/settings/main'
import {useTurns} from '#modules/turns/main'
import {ReactFlowProvider} from '@xyflow/react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

import {CanvasContext} from '../canvas-context'
import {indexTurns, isEmpty, newestReply, pathTo, previousReply} from '../tree'
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

/**
 * The Forks on a Thread unfolded, so the Turn after it is on the canvas; the
 * topmost, the one still on screen, keeps its place.
 */
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

      focusOn(replyId)
    },
    [index, focusOn]
  )

  const jumpTo = useCallback(
    (replyId: string) => {
      const reply = index.replyById.get(replyId)
      const parent = reply ? previousReply(index, reply) : null

      if (parent) setCollapsed(unfoldedOver(index, parent.id))

      focusOn(replyId)
    },
    [index, focusOn]
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
      onSent,
      expandedTurnIds,
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
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-xl">
          <PromptInput
            treeId={treeId}
            parentReplyId={null}
            onSent={replyId => onSent(replyId, null)}
          />
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
          collapsed={collapsed}
          focus={focus}
          fitOnLoad={!startedEmpty}
          switching={switching}
          onHover={setHoverTurnId}
          onOrientation={onOrientation}
          onJump={jumpTo}
        />
      </ReactFlowProvider>
    </CanvasContext>
  )
}
