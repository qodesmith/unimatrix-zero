import type {WantedModel} from '#modules/models/main'
import type {TreeIndex} from './tree'

export interface Draft {
  text: string
  model: WantedModel | null
}

/** The Reply an Input continues from; null for the root Input. */
export type DraftKey = string | null

export const EMPTY_DRAFT: Draft = {text: '', model: null}

/** What sending a failed Reply's Prompt back did to the Input it came from. */
interface Restored {
  at: DraftKey
  before: Draft | undefined
  after: Draft
}

export interface Drafts {
  byInput: ReadonlyMap<DraftKey, Draft>
  /** By failed Reply id; kept through a Retry, dropped once it succeeds. */
  restored: ReadonlyMap<string, Restored>
}

export const NO_DRAFTS: Drafts = {byInput: new Map(), restored: new Map()}

function isEmptyDraft({text, model}: Draft) {
  return text === '' && model === null
}

function sameModel(a: WantedModel | null, b: WantedModel | null) {
  if (a === null || b === null) return a === b

  return a.provider === b.provider && a.model === b.model && a.entry === b.entry
}

function sameDraft(a: Draft | undefined, b: Draft | undefined) {
  if (a === undefined || b === undefined) return a === b

  return a.text === b.text && sameModel(a.model, b.model)
}

function put(
  byInput: Map<DraftKey, Draft>,
  at: DraftKey,
  draft: Draft | undefined
) {
  if (draft === undefined || isEmptyDraft(draft)) byInput.delete(at)
  else byInput.set(at, draft)
}

export function withDraft(drafts: Drafts, at: DraftKey, draft: Draft): Drafts {
  if (sameDraft(drafts.byInput.get(at), draft)) return drafts

  const byInput = new Map(drafts.byInput)
  put(byInput, at, draft)

  return {...drafts, byInput}
}

function withPromptBelow(draft: Draft | undefined, text: string) {
  return draft?.text.trim() ? `${draft.text}\n\n${text}` : text
}

/** The restore made on top of `under`'s, while the Input still holds it. */
function stackedOn(
  restored: ReadonlyMap<string, Restored>,
  byInput: ReadonlyMap<DraftKey, Draft>,
  under: Restored
) {
  for (const [replyId, over] of restored) {
    if (
      over.at === under.at &&
      sameDraft(over.before, under.after) &&
      sameDraft(byInput.get(over.at), over.after)
    ) {
      return {replyId, over}
    }
  }

  return null
}

function takeOut(
  byInput: Map<DraftKey, Draft>,
  restored: Map<string, Restored>,
  taken: Restored,
  index: TreeIndex
) {
  const {at, before, after} = taken

  if (sameDraft(byInput.get(at), after)) {
    put(byInput, at, before)

    return
  }

  const stacked = stackedOn(restored, byInput, taken)
  const reply = stacked && index.replyById.get(stacked.replyId)
  const prompt = reply && index.promptById.get(reply.promptId)

  if (!stacked || !prompt) return

  const rebased: Draft = {
    text: withPromptBelow(before, prompt.text),
    model: stacked.over.after.model,
  }

  byInput.set(at, rebased)
  restored.set(stacked.replyId, {at, before, after: rebased})
}

/**
 * A failed Reply sends its Prompt back to the Input it was sent from, below a
 * draft already there. A Retry that succeeds, or a Prompt sent in its place
 * from another window, takes it out again, unless the user has changed it.
 */
export function reconcileDrafts(drafts: Drafts, index: TreeIndex): Drafts {
  const byInput = new Map(drafts.byInput)
  const restored = new Map(drafts.restored)
  let changed = false

  for (const replyId of drafts.restored.keys()) {
    const taken = restored.get(replyId)
    const status = index.replyById.get(replyId)?.status

    if (!taken || status === 'failed' || status === 'streaming') continue

    restored.delete(replyId)
    takeOut(byInput, restored, taken, index)
    changed = true
  }

  for (const reply of index.replies) {
    const prompt = index.promptById.get(reply.promptId)

    if (reply.status !== 'failed' || restored.has(reply.id) || !prompt) {
      continue
    }

    const at = prompt.parentReplyId
    const before = byInput.get(at)

    const after: Draft = {
      text: withPromptBelow(before, prompt.text),
      model: {provider: reply.provider, model: reply.model, entry: null},
    }

    byInput.set(at, after)
    restored.set(reply.id, {at, before, after})
    changed = true
  }

  return changed ? {byInput, restored} : drafts
}
