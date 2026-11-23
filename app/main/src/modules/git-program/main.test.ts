import type {GitNews} from './main'
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

function heldDownload() {
  const downloads: PromiseWithResolvers<void>[] = []

  const fake = vi.fn<typeof getProgramReady>(async function* (got) {
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
    needsNewerLinux: false,
    tell: fakeTell(),
  })

  const prepared = git.prepare()
  expect(getProgramReady).toHaveBeenCalledWith(target, expect.anything())

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
    needsNewerLinux: false,
    tell: fakeTell(),
  })

  const first = git.prepare()
  git.snapshotWaited()
  const second = git.prepare()

  expect(getProgramReady).toHaveBeenCalledOnce()

  await expect.poll(() => downloads).toHaveLength(1)
  downloads[0]?.resolve()
  await Promise.all([first, second])
})

function fakeTell() {
  return vi.fn<(news: GitNews) => boolean>(() => true)
}

it('tells the user once that Snapshots wait while git downloads, however many wait', () => {
  const tell = fakeTell()
  const {getProgramReady} = heldDownload()

  const git = createGitProgram({
    target,
    needsNewerLinux: false,
    getProgramReady,
    tell,
  })

  git.snapshotWaited()
  git.snapshotWaited()

  expect(tell.mock.calls).toEqual([['downloading']])
})

it('tells the user at the next wait when no window was there to hear it', () => {
  const tell = fakeTell().mockReturnValueOnce(false)
  const {getProgramReady} = heldDownload()

  const git = createGitProgram({
    target,
    needsNewerLinux: false,
    getProgramReady,
    tell,
  })

  git.snapshotWaited()
  git.snapshotWaited()
  git.snapshotWaited()

  expect(tell.mock.calls).toEqual([['downloading'], ['downloading']])
})

it('says nothing of a failed download no Snapshot waited on, so the next wait hears git is downloading, then each failure', async () => {
  const tell = fakeTell()
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    needsNewerLinux: false,
    getProgramReady,
    tell,
  })

  const atLaunch = git.prepare()
  await expect.poll(() => downloads).toHaveLength(1)
  downloads[0]?.reject(new Error('offline'))
  await atLaunch

  expect(tell).not.toHaveBeenCalled()

  git.snapshotWaited()
  await expect.poll(() => downloads).toHaveLength(2)
  downloads[1]?.reject(new Error('offline'))

  await expect
    .poll(() => tell.mock.calls)
    .toEqual([['downloading'], ['download-failed']])

  git.snapshotWaited()
  await expect.poll(() => downloads).toHaveLength(3)
  downloads[2]?.reject(new Error('offline'))

  await expect
    .poll(() => tell.mock.calls)
    .toEqual([['downloading'], ['download-failed'], ['download-failed']])
})

it('downloads again on each Try again, says whether git is then in place, and tells each failure', async () => {
  const tell = fakeTell()
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    needsNewerLinux: false,
    getProgramReady,
    tell,
  })

  const first = git.tryAgain()
  await expect.poll(() => downloads).toHaveLength(1)
  downloads[0]?.reject(new Error('offline'))

  expect(await first).toBe(false)

  const second = git.tryAgain()
  await expect.poll(() => downloads).toHaveLength(2)
  downloads[1]?.reject(new Error('offline'))

  expect(await second).toBe(false)
  expect(tell.mock.calls).toEqual([['download-failed'], ['download-failed']])

  const working = git.tryAgain()
  await expect.poll(() => downloads).toHaveLength(3)
  downloads[2]?.resolve()

  expect(await working).toBe(true)
  expect(git.program()).not.toBeNull()
})

it('tells the user once, on Linux too old for the build, that file history can’t work, and never that a download is coming', async () => {
  const tell = fakeTell()
  const {getProgramReady} = heldDownload()

  const git = createGitProgram({
    target: null,
    needsNewerLinux: true,
    getProgramReady,
    tell,
  })

  await git.prepare()
  git.snapshotWaited()
  git.snapshotWaited()

  expect(getProgramReady).not.toHaveBeenCalled()
  expect(tell.mock.calls).toEqual([['needs-newer-linux']])
})

it('downloads again when a Snapshot waits after the download failed, and never rejects', async () => {
  const {getProgramReady, downloads} = heldDownload()

  const git = createGitProgram({
    target,
    getProgramReady,
    needsNewerLinux: false,
    tell: fakeTell(),
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
  const tell = fakeTell()
  const {getProgramReady} = heldDownload()

  const git = createGitProgram({
    target: null,
    needsNewerLinux: false,
    getProgramReady,
    tell,
  })

  await git.prepare()
  git.snapshotWaited()

  expect(getProgramReady).not.toHaveBeenCalled()
  expect(tell).not.toHaveBeenCalled()
  expect(git.program()).toBeNull()
})
