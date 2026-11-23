import type {GitDownloadEvent} from './download/machine'
import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import {programOf} from '@uz/vendor-program'

import {
  downloadingIsNews,
  gitDownloadTransition,
  initialGitDownload,
} from './download/machine'

/** What the user hears about Snapshots waiting on the app's own `git`. */
export type GitNews = 'downloading' | 'download-failed' | 'needs-newer-linux'

interface GitProgramDeps {
  target: ProgramTarget | null
  /** The build can't run here, so `target` is null and nothing downloads. */
  needsNewerLinux: boolean
  getProgramReady: typeof getProgramReady
  /** False if no window heard. */
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
      send({type: 'downloaded'})
    } catch {
      if (!waitedOn) send({type: 'failed-unheard'})
      else if (send({type: 'failed'}))
        // Each attempt follows a wait or a Try again, so at most once a Reply.
        tell('download-failed')
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

    /** Never rejects. */
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

    /** The user's Try again. Never rejects; true once `git` is in place. */
    async tryAgain() {
      waitedOn = true
      await prepare()

      return state.status === 'in-place'
    },
  }
}
