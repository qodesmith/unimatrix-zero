import type {PromptSendEvent, PromptSendState} from './machine'

import {describe, expect, it} from 'vitest'

import {initialPromptSend, promptSendTransition} from './machine'

const sending = {status: 'sending'} satisfies PromptSendState

const refused = {
  status: 'refused',
  error: 'The disk is full.',
} satisfies PromptSendState

// @ts-expect-error only a refusal holds an error
void ({status: 'sending', error: 'Gone'} satisfies PromptSendState)

const ALL: PromptSendEvent[] = [
  {type: 'submitted'},
  {type: 'sent'},
  {type: 'refused', error: 'Not now'},
]

function except(...types: PromptSendEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the Prompt send machine', () => {
  describe('idle', () => {
    it('sends once submitted', () => {
      expect(
        promptSendTransition(initialPromptSend, {type: 'submitted'})
      ).toEqual(sending)
    })

    it('ignores every event but submitted', () => {
      for (const event of except('submitted')) {
        expect(promptSendTransition(initialPromptSend, event)).toBe(
          initialPromptSend
        )
      }
    })
  })

  describe('sending', () => {
    it('goes back to idle once sent', () => {
      expect(promptSendTransition(sending, {type: 'sent'})).toEqual(
        initialPromptSend
      )
    })

    it('holds main’s refusal', () => {
      expect(
        promptSendTransition(sending, {type: 'refused', error: 'Not now'})
      ).toEqual({status: 'refused', error: 'Not now'})
    })

    it('ignores being submitted again', () => {
      expect(promptSendTransition(sending, {type: 'submitted'})).toBe(sending)
    })
  })

  describe('refused', () => {
    it('sends again once submitted, dropping the refusal', () => {
      expect(promptSendTransition(refused, {type: 'submitted'})).toEqual(
        sending
      )
    })

    it('ignores every event but submitted', () => {
      for (const event of except('submitted')) {
        expect(promptSendTransition(refused, event)).toBe(refused)
      }
    })
  })
})
