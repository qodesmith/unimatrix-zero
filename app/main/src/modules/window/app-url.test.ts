import {describe, expect, it} from 'vitest'

import {isAppUrl, isTopLevelAppFrame} from './app-url'

const appUrl = 'app://unimatrix-zero/'

describe('isAppUrl', () => {
  it.each(['app://unimatrix-zero/', 'app://unimatrix-zero/assets/x.js'])(
    'accepts %s',
    url => {
      expect(isAppUrl(url, appUrl)).toBe(true)
    }
  )

  it.each([
    'about:blank',
    'data:text/html,x',
    'app://elsewhere/',
    'app-dev://unimatrix-zero/',
    'uzfile://unimatrix-zero/1',
    '',
    'not a url',
  ])('rejects %j', url => {
    expect(isAppUrl(url, appUrl)).toBe(false)
  })
})

describe('isTopLevelAppFrame', () => {
  const mainFrame = {url: appUrl}
  const sender = {mainFrame}

  it('trusts the main frame on the app URL', () => {
    expect(isTopLevelAppFrame({senderFrame: mainFrame, sender}, appUrl)).toBe(
      true
    )
  })

  it('refuses a subframe on the app URL', () => {
    expect(
      isTopLevelAppFrame({senderFrame: {url: appUrl}, sender}, appUrl)
    ).toBe(false)
  })

  it('refuses a sender whose frame is gone', () => {
    expect(isTopLevelAppFrame({senderFrame: null, sender}, appUrl)).toBe(false)
  })

  it.each(['about:blank', ''])(
    'refuses the main frame on %j without throwing',
    url => {
      const frame = {url}
      expect(
        isTopLevelAppFrame(
          {senderFrame: frame, sender: {mainFrame: frame}},
          appUrl
        )
      ).toBe(false)
    }
  )
})
