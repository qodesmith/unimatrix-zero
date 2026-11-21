import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import {programOf} from '@uz/vendor-program'

interface GitProgramDeps {
  /** The manifest's `git` for this machine, and where it goes; null if none. */
  target: ProgramTarget | null
  getProgramReady: typeof getProgramReady
  /**
   * Tells the user that Snapshots start once the download finishes; false when
   * no window was there to hear it.
   */
  onWaiting: () => boolean
}

/**
 * The app's own `git` (ADR 0024), downloaded beside the vendor programs. Until
 * it is in place no Snapshot is taken.
 */
export function createGitProgram({
  target,
  getProgramReady,
  onWaiting,
}: GitProgramDeps) {
  let inPlace = false
  let downloading: Promise<void> | null = null
  let told = false

  async function download(git: ProgramTarget) {
    try {
      for await (const _progress of getProgramReady(git, {
        signal: new AbortController().signal,
      }));
      inPlace = true
    } catch {
      // A Snapshot that waits for it starts the download again.
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
    /** The `git` to run by its full path, or null while it isn't in place. */
    program: () => (target && inPlace ? programOf(target) : null),

    /** Downloads it unless it is in place or downloading. Never rejects. */
    prepare,

    /** A Snapshot wasn't taken for want of it. */
    snapshotWaited() {
      if (!target) return

      if (!told) told = onWaiting()

      void prepare()
    },
  }
}
