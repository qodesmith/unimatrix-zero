import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

export type ImageLoadState =
  | {status: 'unloaded'}
  | {status: 'loading'}
  | {status: 'loaded'; dataUrl: string}
  | {status: 'failed'; message: string}

export type ImageLoadEvent =
  | {type: 'loadAsked'}
  | {type: 'loaded'; dataUrl: string}
  | {type: 'refused'; message: string}

export const initialImageLoad: ImageLoadState = {status: 'unloaded'}

const transitions = {
  unloaded: {loadAsked: () => ({status: 'loading'})},
  loading: {
    loaded: (_, {dataUrl}) => ({status: 'loaded', dataUrl}),
    refused: (_, {message}) => ({status: 'failed', message}),
  },
  loaded: {},
  failed: {loadAsked: () => ({status: 'loading'})},
} satisfies Transitions<ImageLoadState, ImageLoadEvent>

export const imageLoadTransition = machine<ImageLoadState, ImageLoadEvent>(
  transitions
)
