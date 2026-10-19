import {describe, expect, it} from 'vitest'

import {dispatchCommand} from './main'

const trusted = {isTopLevelAppFrame: true}
const clock = {now: () => new Date('2026-10-19T12:00:00.000Z')}

describe('app.ping', () => {
  it('round-trips the nonce with the time main replied', async () => {
    const reply = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1'},
      trusted,
      clock
    )
    expect(reply).toEqual({
      ok: true,
      value: {nonce: 'n-1', repliedAt: '2026-10-19T12:00:00.000Z'},
    })
  })

  it('rejects a command carrying an unknown key', async () => {
    const reply = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1', extra: true},
      trusted,
      clock
    )
    expect(reply).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })

  it('rejects a command type it does not know', async () => {
    const reply = await dispatchCommand({type: 'app.nope'}, trusted, clock)
    expect(reply).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })

  it('refuses a sender that is not the top-level app frame', async () => {
    const reply = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1'},
      {isTopLevelAppFrame: false},
      clock
    )
    expect(reply).toMatchObject({ok: false, error: {code: 'untrusted-sender'}})
  })
})
