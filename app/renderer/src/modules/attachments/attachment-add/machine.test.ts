import type {AttachmentAddEvent, AttachmentAddState} from './machine'

import {describe, expect, it} from 'vitest'

import {attachmentAddTransition, startedAdding} from './machine'

const adding = startedAdding('notes.pdf')

const added = {status: 'added'} satisfies AttachmentAddState

const refused = {
  status: 'refused',
  name: 'notes.pdf',
  error: 'The disk is full.',
} satisfies AttachmentAddState

// @ts-expect-error only a refusal holds an error
void ({status: 'adding', name: 'a', error: 'Gone'} satisfies AttachmentAddState)

// @ts-expect-error the attachment main kept stays out of the machine
void ({status: 'added', attachment: {}} satisfies AttachmentAddState)

const ALL: AttachmentAddEvent[] = [
  {type: 'added'},
  {type: 'refused', error: 'Not now'},
]

describe('the attachment add machine', () => {
  describe('adding', () => {
    it('starts adding the named file', () => {
      expect(adding).toEqual({status: 'adding', name: 'notes.pdf'})
    })

    it('ends the add once main kept the file', () => {
      expect(attachmentAddTransition(adding, {type: 'added'})).toEqual(added)
    })

    it('holds main’s refusal, with the file’s name', () => {
      expect(
        attachmentAddTransition(adding, {
          type: 'refused',
          error: 'The disk is full.',
        })
      ).toEqual(refused)
    })
  })

  describe('added', () => {
    it('ignores every event', () => {
      for (const event of ALL) {
        expect(attachmentAddTransition(added, event)).toBe(added)
      }
    })
  })

  describe('refused', () => {
    it('ignores every event', () => {
      for (const event of ALL) {
        expect(attachmentAddTransition(refused, event)).toBe(refused)
      }
    })
  })
})
