import {describe, expect, it} from 'vitest'

import {dispatchCommand} from './main'

const trusted = {isTopLevelAppFrame: true}
const clock = {now: () => new Date('2026-10-19T12:00:00.000Z')}

describe('app.ping', () => {
  it('round-trips the nonce with the time main received it', async () => {
    const outcome = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1'},
      trusted,
      clock
    )

    expect(outcome).toEqual({
      ok: true,
      value: {nonce: 'n-1', receivedAt: '2026-10-19T12:00:00.000Z'},
    })
  })

  it('rejects a command carrying an unknown key', async () => {
    const outcome = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1', extra: true},
      trusted,
      clock
    )

    expect(outcome).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })

  it('rejects a command type it does not know', async () => {
    const outcome = await dispatchCommand({type: 'app.nope'}, trusted, clock)
    expect(outcome).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })

  it('refuses a sender that is not the top-level app frame', async () => {
    const outcome = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1'},
      {isTopLevelAppFrame: false},
      clock
    )

    expect(outcome).toMatchObject({
      ok: false,
      error: {code: 'untrusted-sender'},
    })
  })
})
