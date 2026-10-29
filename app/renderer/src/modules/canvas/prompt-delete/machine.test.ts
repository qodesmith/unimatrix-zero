import type {PromptDeleteEvent, PromptDeleteState} from './machine'

import {describe, expect, it} from 'vitest'

import {initialPromptDelete, promptDeleteTransition} from './machine'

const armed = {status: 'armed'} satisfies PromptDeleteState
const deleting = {status: 'deleting'} satisfies PromptDeleteState

const refused = {
  status: 'refused',
  error: 'A Reply is streaming',
} satisfies PromptDeleteState

// @ts-expect-error only a refusal holds an error
void ({status: 'armed', error: 'Gone'} satisfies PromptDeleteState)

const ALL: PromptDeleteEvent[] = [
  {type: 'armed'},
  {type: 'canceled'},
  {type: 'confirmed'},
  {type: 'refused', error: 'Not now'},
]

function except(...types: PromptDeleteEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the Prompt delete machine', () => {
  describe('idle', () => {
    it('arms', () => {
      expect(
        promptDeleteTransition(initialPromptDelete, {type: 'armed'})
      ).toEqual(armed)
    })

    it('ignores every event but armed', () => {
      for (const event of except('armed')) {
        expect(promptDeleteTransition(initialPromptDelete, event)).toBe(
          initialPromptDelete
        )
      }
    })
  })

  describe('armed', () => {
    it('goes back to idle when canceled', () => {
      expect(promptDeleteTransition(armed, {type: 'canceled'})).toEqual(
        initialPromptDelete
      )
    })

    it('deletes once confirmed', () => {
      expect(promptDeleteTransition(armed, {type: 'confirmed'})).toEqual(
        deleting
      )
    })

    it('ignores being armed again and a refusal', () => {
      for (const event of except('canceled', 'confirmed')) {
        expect(promptDeleteTransition(armed, event)).toBe(armed)
      }
    })
  })

  describe('deleting', () => {
    it('holds main’s refusal', () => {
      expect(
        promptDeleteTransition(deleting, {type: 'refused', error: 'Not now'})
      ).toEqual({status: 'refused', error: 'Not now'})
    })

    it('ignores every event but a refusal, canceling included', () => {
      for (const event of except('refused')) {
        expect(promptDeleteTransition(deleting, event)).toBe(deleting)
      }
    })
  })

  describe('refused', () => {
    it('goes back to idle when canceled', () => {
      expect(promptDeleteTransition(refused, {type: 'canceled'})).toEqual(
        initialPromptDelete
      )
    })

    it('asks again once confirmed', () => {
      expect(promptDeleteTransition(refused, {type: 'confirmed'})).toEqual(
        deleting
      )
    })

    it('ignores being armed again and another refusal', () => {
      for (const event of except('canceled', 'confirmed')) {
        expect(promptDeleteTransition(refused, event)).toBe(refused)
      }
    })
  })
})
