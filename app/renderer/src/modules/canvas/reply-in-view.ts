import type {Reply} from '@uz/contract/turns'

/**
 * The Reply the user is looking at: the slideout's end while it is open, else
 * the one the Active Thread ends at. Esc stops it, and the Files section shows
 * its Snapshot.
 */
export function replyInView(
  chatOpen: boolean,
  chatEnd: Reply | null,
  activeReplyId: string | null
) {
  return chatOpen && chatEnd ? chatEnd.id : activeReplyId
}
