import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import {programOf} from '@uz/vendor-program'

interface GitProgramDeps {
  target: ProgramTarget | null
  getProgramReady: typeof getProgramReady
  /** Tells the user Snapshots wait on git; false if no window heard. */
  onWaiting: () => boolean
}

/** The app's own `git`: no Snapshot is taken until it's in place (ADR 0024). */
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
    program: () => (target && inPlace ? programOf(target) : null),

    /** Never rejects. */
    prepare,

    /** A Snapshot wasn't taken for want of it. */
    snapshotWaited() {
      if (!target) return

      if (!told) told = onWaiting()

      void prepare()
    },
  }
}
