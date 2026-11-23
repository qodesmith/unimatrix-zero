import type {GitDownloadEvent, GitDownloadState} from './machine'

import {describe, expect, it} from 'vitest'

import {
  downloadingIsNews,
  gitDownloadTransition,
  initialGitDownload,
} from './machine'

const downloading = {status: 'downloading'} satisfies GitDownloadState
const failed = {status: 'failed'} satisfies GitDownloadState

const downloadingAgain = {
  status: 'downloading-again',
} satisfies GitDownloadState

const inPlace = {status: 'in-place'} satisfies GitDownloadState

const ALL: GitDownloadEvent[] = [
  {type: 'started'},
  {type: 'downloaded'},
  {type: 'failed'},
  {type: 'failed-unheard'},
]

function except(...types: GitDownloadEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the git download machine', () => {
  describe('idle', () => {
    it('downloads once started', () => {
      expect(
        gitDownloadTransition(initialGitDownload, {type: 'started'})
      ).toEqual(downloading)
    })

    it('ignores every event but started', () => {
      for (const event of except('started')) {
        expect(gitDownloadTransition(initialGitDownload, event)).toBe(
          initialGitDownload
        )
      }
    })
  })

  describe('downloading', () => {
    it('is in place once downloaded', () => {
      expect(gitDownloadTransition(downloading, {type: 'downloaded'})).toEqual(
        inPlace
      )
    })

    it('fails when the download fails', () => {
      expect(gitDownloadTransition(downloading, {type: 'failed'})).toEqual(
        failed
      )
    })

    it('is idle again when the download fails with no one waiting on it', () => {
      expect(
        gitDownloadTransition(downloading, {type: 'failed-unheard'})
      ).toEqual(initialGitDownload)
    })

    it('ignores started', () => {
      expect(gitDownloadTransition(downloading, {type: 'started'})).toBe(
        downloading
      )
    })
  })

  describe('failed', () => {
    it('downloads again once started', () => {
      expect(gitDownloadTransition(failed, {type: 'started'})).toEqual(
        downloadingAgain
      )
    })

    it('ignores every event but started', () => {
      for (const event of except('started')) {
        expect(gitDownloadTransition(failed, event)).toBe(failed)
      }
    })
  })

  describe('downloading again', () => {
    it('is in place once downloaded', () => {
      expect(
        gitDownloadTransition(downloadingAgain, {type: 'downloaded'})
      ).toEqual(inPlace)
    })

    it('fails again when the download fails', () => {
      expect(gitDownloadTransition(downloadingAgain, {type: 'failed'})).toEqual(
        failed
      )
    })

    it('ignores started and failed-unheard', () => {
      for (const event of except('downloaded', 'failed')) {
        expect(gitDownloadTransition(downloadingAgain, event)).toBe(
          downloadingAgain
        )
      }
    })
  })

  describe('in place', () => {
    it('ignores every event', () => {
      for (const event of ALL) {
        expect(gitDownloadTransition(inPlace, event)).toBe(inPlace)
      }
    })
  })

  it('counts a wait as news only while no download the user heard of has failed and git is not in place', () => {
    expect(downloadingIsNews(initialGitDownload)).toBe(true)
    expect(downloadingIsNews(downloading)).toBe(true)
    expect(downloadingIsNews(failed)).toBe(false)
    expect(downloadingIsNews(downloadingAgain)).toBe(false)
    expect(downloadingIsNews(inPlace)).toBe(false)
  })
})
