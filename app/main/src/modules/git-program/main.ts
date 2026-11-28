import type {GitDownloadEvent} from './download/machine'
import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import {programOf} from '@uz/vendor-program'

import {
  downloadingIsNews,
  gitDownloadTransition,
  initialGitDownload,
} from './download/machine'

export type GitNews =
  | 'downloading'
  | 'download-failed'
  | 'downloaded'
  | 'needs-newer-linux'

interface GitProgramDeps {
  target: ProgramTarget | null
  needsNewerLinux: boolean
  getProgramReady: typeof getProgramReady
  tell: (news: GitNews) => boolean
}

/** The app's own `git`: no Snapshot is taken until it's in place (ADR 0024). */
export function createGitProgram({
  target,
  needsNewerLinux,
  getProgramReady,
  tell,
}: GitProgramDeps) {
  let state = initialGitDownload
  let downloading: Promise<void> | null = null
  let waitedOn = false
  const told = new Set<GitNews>()

  function send(event: GitDownloadEvent) {
    const before = state
    state = gitDownloadTransition(before, event)

    return state !== before
  }

  function tellOnce(news: GitNews) {
    if (!told.has(news) && tell(news)) told.add(news)
  }

  async function download(git: ProgramTarget) {
    send({type: 'started'})

    try {
      for await (const _progress of getProgramReady(git, {
        signal: new AbortController().signal,
      }));
      const afterFailure = state.status === 'downloading-again'

      if (send({type: 'downloaded'}) && afterFailure) tell('downloaded')
    } catch {
      if (!waitedOn) send({type: 'failed-unheard'})
      else if (send({type: 'failed'})) {
        // Not `tellOnce`: a Snapshot or a Try again waited on this attempt, so its failure is news.
        tell('download-failed')
      }
    } finally {
      downloading = null
    }
  }

  async function prepare() {
    if (!target || state.status === 'in-place') return

    downloading ??= download(target)
    await downloading
  }

  return {
    program: () =>
      target && state.status === 'in-place' ? programOf(target) : null,

    prepare,

    snapshotWaited() {
      if (needsNewerLinux) {
        tellOnce('needs-newer-linux')

        return
      }

      if (!target) return

      waitedOn = true

      if (downloadingIsNews(state)) tellOnce('downloading')

      void prepare()
    },

    async tryAgain() {
      waitedOn = true
      await prepare()

      return state.status === 'in-place'
    },
  }
}
