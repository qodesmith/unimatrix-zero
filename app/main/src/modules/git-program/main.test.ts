import type {ProgramTarget, getProgramReady} from '@uz/vendor-program'

import path from 'node:path'
import {expect, it, vi} from 'vitest'

import {createGitProgram} from './main'

const target: ProgramTarget = {
  path: path.join('/data', 'vendor', 'git', '2.53.0'),
  build: {
    url: 'https://github.com/desktop/dugite-native/releases/download/v2.53.0/git.tar.gz',
    sha256: 'a'.repeat(64),
    size: 1000,
    archive: {format: 'tar.gz', entrypoint: 'bin/git'},
  },
}

/** A download the test finishes, or fails, when it says. */
function heldDownload() {
  const downloads: PromiseWithResolvers<void>[] = []

  const fake = vi.fn<typeof getProgramReady>(async function* (got) {
    expect(got).toBe(target)
    const download = Promise.withResolvers<void>()
    downloads.push(download)
    yield {receivedBytes: 0, totalBytes: got.build.size}
    await download.promise
  })

  return {getProgramReady: fake, downloads}
}

it('names no git until its download is in place, then the entrypoint inside it by full path', async () => {
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    getProgramReady,
    onWaiting: vi.fn<() => void>(),
  })

  const prepared = git.prepare()

  await expect.poll(() => downloads).toHaveLength(1)
  expect(git.program()).toBeNull()

  downloads[0]?.resolve()
  await prepared

  expect(git.program()).toBe(path.join(target.path, 'bin', 'git'))
})

it('downloads once however many ask while it downloads', async () => {
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    getProgramReady,
    onWaiting: vi.fn<() => void>(),
  })

  const first = git.prepare()
  git.snapshotWaited()
  const second = git.prepare()
  downloads[0]?.resolve()
  await Promise.all([first, second])

  expect(getProgramReady).toHaveBeenCalledOnce()
})

it('tells the user once that Snapshots wait, however many wait', () => {
  const onWaiting = vi.fn<() => void>()
  const {getProgramReady} = heldDownload()
  const git = createGitProgram({target, getProgramReady, onWaiting})

  git.snapshotWaited()
  git.snapshotWaited()

  expect(onWaiting).toHaveBeenCalledOnce()
})

it('downloads again when a Snapshot waits after the download failed, and never rejects', async () => {
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    getProgramReady,
    onWaiting: vi.fn<() => void>(),
  })

  const failing = git.prepare()
  await expect.poll(() => downloads).toHaveLength(1)
  downloads[0]?.reject(new Error('offline'))
  await failing

  expect(git.program()).toBeNull()

  git.snapshotWaited()
  await expect.poll(() => downloads).toHaveLength(2)
  downloads[1]?.resolve()

  await expect.poll(() => git.program()).not.toBeNull()
})

it('never downloads, or says a download is coming, on a machine the manifest has no git for', async () => {
  const onWaiting = vi.fn<() => void>()
  const {getProgramReady} = heldDownload()

  const git = createGitProgram({target: null, getProgramReady, onWaiting})
  await git.prepare()
  git.snapshotWaited()

  expect(getProgramReady).not.toHaveBeenCalled()
  expect(onWaiting).not.toHaveBeenCalled()
  expect(git.program()).toBeNull()
})
