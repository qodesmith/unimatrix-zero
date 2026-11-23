import type {Transitions} from '@uz/contract/state-machine'

import {machine} from '@uz/contract/state-machine'

export type GitDownloadState =
  | {status: 'idle'}
  | {status: 'downloading'}
  | {status: 'failed'}
  | {status: 'downloading-again'}
  | {status: 'in-place'}

export type GitDownloadEvent =
  | {type: 'started'}
  | {type: 'downloaded'}
  | {type: 'failed'}

export const initialGitDownload: GitDownloadState = {status: 'idle'}

function downloaded(): GitDownloadState {
  return {status: 'in-place'}
}

function failed(): GitDownloadState {
  return {status: 'failed'}
}

const transitions = {
  idle: {started: () => ({status: 'downloading'})},
  downloading: {downloaded, failed},
  failed: {started: () => ({status: 'downloading-again'})},
  'downloading-again': {downloaded, failed},
  'in-place': {},
} satisfies Transitions<GitDownloadState, GitDownloadEvent>

export const gitDownloadTransition = machine<
  GitDownloadState,
  GitDownloadEvent
>(transitions)

/** After a failure, only the outcome of the next attempt is news. */
export function downloadingIsNews(state: GitDownloadState) {
  switch (state.status) {
    case 'idle':
    case 'downloading':
      return true
    case 'failed':
    case 'downloading-again':
    case 'in-place':
      return false
    default:
      throw new Error('Unknown git download state.')
  }
}
