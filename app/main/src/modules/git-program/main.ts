import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import {programOf} from '@uz/vendor-program'

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
  let inPlace = false
  let downloading: Promise<void> | null = null
  let failed = false
  // Once a Snapshot or the user waits on it, a failed download is told.
  let awaited = false
  const told = new Set<GitNews>()

  function tellOnce(news: GitNews) {
    if (!told.has(news) && tell(news)) told.add(news)
  }

  async function download(git: ProgramTarget) {
    try {
      for await (const _progress of getProgramReady(git, {
        signal: new AbortController().signal,
      }));
      inPlace = true
      failed = false
    } catch {
      failed = true

      // Each attempt follows a wait or a Try again, so at most once a Reply.
      if (awaited) tell('download-failed')
    } finally {
      downloading = null
    }
  }

  async function prepare() {
    if (!target || inPlace) return

    downloading ??= download(target)
    await downloading
  }

  return {
    program: () => (target && inPlace ? programOf(target) : null),

    /** Never rejects. */
    prepare,

    snapshotWaited() {
      if (needsNewerLinux) {
        tellOnce('needs-newer-linux')

        return
      }

      if (!target) return

      awaited = true

      // After a failure, only the outcome of the next attempt is news.
      if (!failed) tellOnce('downloading')

      void prepare()
    },

    /** The user's Try again. Never rejects; true once `git` is in place. */
    async retry() {
      awaited = true
      await prepare()

      return inPlace
    },
  }
}
