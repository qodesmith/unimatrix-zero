import type {ImageLoadEvent, ImageLoadState} from './machine'

import {describe, expect, it} from 'vitest'

import {imageLoadTransition, initialImageLoad} from './machine'

const loading = {status: 'loading'} satisfies ImageLoadState

const loaded = {
  status: 'loaded',
  dataUrl: 'data:image/png;base64,AA==',
} satisfies ImageLoadState

const failed = {
  status: 'failed',
  message: 'The image is too large.',
} satisfies ImageLoadState

// @ts-expect-error only a loaded image holds its data
void ({status: 'loading', dataUrl: 'data:,'} satisfies ImageLoadState)

const ALL: ImageLoadEvent[] = [
  {type: 'loadAsked'},
  {type: 'loaded', dataUrl: 'data:image/png;base64,BB=='},
  {type: 'refused', message: 'Not now'},
]

function except(...types: ImageLoadEvent['type'][]) {
  return ALL.filter(event => !types.includes(event.type))
}

describe('the image load machine', () => {
  describe('unloaded', () => {
    it('loads once asked', () => {
      expect(
        imageLoadTransition(initialImageLoad, {type: 'loadAsked'})
      ).toEqual(loading)
    })

    it('ignores every event but loadAsked', () => {
      for (const event of except('loadAsked')) {
        expect(imageLoadTransition(initialImageLoad, event)).toBe(
          initialImageLoad
        )
      }
    })
  })

  describe('loading', () => {
    it('holds the image main fetched', () => {
      expect(
        imageLoadTransition(loading, {type: 'loaded', dataUrl: 'data:,'})
      ).toEqual({status: 'loaded', dataUrl: 'data:,'})
    })

    it('holds main’s refusal', () => {
      expect(
        imageLoadTransition(loading, {type: 'refused', message: 'Not now'})
      ).toEqual({status: 'failed', message: 'Not now'})
    })

    it('ignores being asked again', () => {
      expect(imageLoadTransition(loading, {type: 'loadAsked'})).toBe(loading)
    })
  })

  describe('loaded', () => {
    it('ignores every event', () => {
      for (const event of ALL) {
        expect(imageLoadTransition(loaded, event)).toBe(loaded)
      }
    })
  })

  describe('failed', () => {
    it('loads again once asked, dropping the refusal', () => {
      expect(imageLoadTransition(failed, {type: 'loadAsked'})).toEqual(loading)
    })

    it('ignores every event but loadAsked', () => {
      for (const event of except('loadAsked')) {
        expect(imageLoadTransition(failed, event)).toBe(failed)
      }
    })
  })
})
