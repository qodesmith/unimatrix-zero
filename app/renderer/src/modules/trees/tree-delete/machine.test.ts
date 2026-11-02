import type {TreeDeleteEvent, TreeDeleteState} from './machine'

import {describe, expect, it} from 'vitest'

import {initialTreeDelete, treeDeleteTransition} from './machine'

const asking = {status: 'asking'} satisfies TreeDeleteState
const deleting = {status: 'deleting'} satisfies TreeDeleteState

const refused = {
  status: 'refused',
  error: 'A The disk is full',
} satisfies TreeDeleteState

// @ts-expect-error only a refusal holds an error
void ({status: 'asking', error: 'Gone'} satisfies TreeDeleteState)

const ALL: TreeDeleteEvent[] = [
  {type: 'asked'},
  {type: 'canceled'},
  {type: 'confirmed'},
  {type: 'refused', error: 'Not now'},
]

function except(...types: TreeDeleteEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the Tree delete machine', () => {
  describe('idle', () => {
    it('asks', () => {
      expect(treeDeleteTransition(initialTreeDelete, {type: 'asked'})).toEqual(
        asking
      )
    })

    it('ignores every event but asked', () => {
      for (const event of except('asked')) {
        expect(treeDeleteTransition(initialTreeDelete, event)).toBe(
          initialTreeDelete
        )
      }
    })
  })

  describe('asking', () => {
    it('goes back to idle when canceled', () => {
      expect(treeDeleteTransition(asking, {type: 'canceled'})).toEqual(
        initialTreeDelete
      )
    })

    it('deletes once confirmed', () => {
      expect(treeDeleteTransition(asking, {type: 'confirmed'})).toEqual(
        deleting
      )
    })

    it('ignores being asked again and a refusal', () => {
      for (const event of except('canceled', 'confirmed')) {
        expect(treeDeleteTransition(asking, event)).toBe(asking)
      }
    })
  })

  describe('deleting', () => {
    it('holds main’s refusal', () => {
      expect(
        treeDeleteTransition(deleting, {type: 'refused', error: 'Not now'})
      ).toEqual({status: 'refused', error: 'Not now'})
    })

    it('ignores every event but a refusal, canceling included', () => {
      for (const event of except('refused')) {
        expect(treeDeleteTransition(deleting, event)).toBe(deleting)
      }
    })
  })

  describe('refused', () => {
    it('goes back to idle when canceled', () => {
      expect(treeDeleteTransition(refused, {type: 'canceled'})).toEqual(
        initialTreeDelete
      )
    })

    it('asks again once confirmed', () => {
      expect(treeDeleteTransition(refused, {type: 'confirmed'})).toEqual(
        deleting
      )
    })

    it('ignores being asked again and another refusal', () => {
      for (const event of except('canceled', 'confirmed')) {
        expect(treeDeleteTransition(refused, event)).toBe(refused)
      }
    })
  })
})
