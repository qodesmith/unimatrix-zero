import type {AttachmentAddEvent, AttachmentAddState} from './machine'

import {describe, expect, it} from 'vitest'

import {attachmentAddTransition, startedAdding} from './machine'

const attachment = {
  id: '01a16096-00ad-7d3b-8205-000000000001',
  name: 'notes.pdf',
  mediaType: 'application/pdf',
  size: 2048,
} as const

const adding = startedAdding('notes.pdf')

const added = {status: 'added', attachment} satisfies AttachmentAddState

const refused = {
  status: 'refused',
  name: 'notes.pdf',
  error: 'The disk is full.',
} satisfies AttachmentAddState

// @ts-expect-error only a refusal holds an error
void ({status: 'adding', name: 'a', error: 'Gone'} satisfies AttachmentAddState)

const ALL: AttachmentAddEvent[] = [
  {type: 'added', attachment},
  {type: 'refused', error: 'Not now'},
]

describe('the attachment add machine', () => {
  describe('adding', () => {
    it('starts adding the named file', () => {
      expect(adding).toEqual({status: 'adding', name: 'notes.pdf'})
    })

    it('holds the attachment main kept', () => {
      expect(
        attachmentAddTransition(adding, {type: 'added', attachment})
      ).toEqual(added)
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
