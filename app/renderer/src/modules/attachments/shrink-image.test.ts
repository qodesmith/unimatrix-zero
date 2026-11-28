import {
  INLINE_IMAGE_PIXELS,
  INLINE_IMAGE_SIZE_LIMIT,
} from '@uz/contract/attachments'
import {expect, it} from 'vitest'

import {shrunkImage} from './shrink-image'

type Paint = (context: OffscreenCanvasRenderingContext2D) => void

function noise(context: OffscreenCanvasRenderingContext2D) {
  const {width, height} = context.canvas
  const pixels = context.createImageData(width, height)
  let seed = 1

  for (let at = 0; at < pixels.data.length; at += 1) {
    seed = (seed * 48_271) % 2_147_483_647
    pixels.data[at] = at % 4 === 3 ? 255 : seed % 256
  }

  context.putImageData(pixels, 0, 0)
}

async function image(
  type: string,
  width: number,
  height: number,
  paint: Paint = context => {
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
  }
) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')

  if (!context) throw new Error('No 2D context.')

  paint(context)

  return canvas.convertToBlob({type})
}

async function decoded(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const bitmap = await createImageBitmap(new Blob([bytes], {type}))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')

  context?.drawImage(bitmap, 0, 0)

  return {
    width: bitmap.width,
    height: bitmap.height,
    firstPixel: [...(context?.getImageData(0, 0, 1, 1).data ?? [])],
  }
}

const PNG_START = [0x89, 0x50, 0x4e, 0x47]
const JPEG_START = [0xff, 0xd8, 0xff]

it('shrinks an image longer than an inline image may be so its long side fits, keeping its shape and a PNG’s transparency', async () => {
  const source = await image(
    'image/png',
    INLINE_IMAGE_PIXELS * 2,
    500,
    () => {}
  )

  const shrunk = await shrunkImage(new File([source], 'wide.png', source))

  expect(Array.from(shrunk?.slice(0, 4) ?? [])).toEqual(PNG_START)
  expect(await decoded(shrunk ?? new Uint8Array(), 'image/png')).toEqual({
    width: INLINE_IMAGE_PIXELS,
    height: 250,
    firstPixel: [0, 0, 0, 0],
  })
})

it('shrinks a tall JPEG to a JPEG', async () => {
  const source = await image('image/jpeg', 300, INLINE_IMAGE_PIXELS + 1000)
  const shrunk = await shrunkImage(new File([source], 'tall.jpg', source))

  expect(Array.from(shrunk?.slice(0, 3) ?? [])).toEqual(JPEG_START)
  expect(await decoded(shrunk ?? new Uint8Array(), 'image/jpeg')).toMatchObject(
    {width: 200, height: INLINE_IMAGE_PIXELS}
  )
})

it('encodes again an image that fits in pixels but not in bytes, as a JPEG on white when its PNG is still too large', async () => {
  const side = INLINE_IMAGE_PIXELS
  const source = await image('image/png', side, side, noise)

  expect(source.size).toBeGreaterThan(INLINE_IMAGE_SIZE_LIMIT)

  const shrunk = await shrunkImage(new File([source], 'noise.png', source))

  expect(Array.from(shrunk?.slice(0, 3) ?? [])).toEqual(JPEG_START)
  expect(shrunk?.byteLength).toBeLessThanOrEqual(INLINE_IMAGE_SIZE_LIMIT)
  expect(await decoded(shrunk ?? new Uint8Array(), 'image/jpeg')).toMatchObject(
    {width: side, height: side}
  )
})

it('puts white behind a transparent image that goes as a JPEG', async () => {
  const source = await image(
    'image/webp',
    INLINE_IMAGE_PIXELS + 100,
    10,
    () => {}
  )

  const shrunk = await shrunkImage(new File([source], 'clear.webp', source))

  expect(
    (await decoded(shrunk ?? new Uint8Array(), 'image/jpeg')).firstPixel
  ).toEqual([255, 255, 255, 255])
})

it('leaves alone an image that already fits', async () => {
  const source = await image('image/png', INLINE_IMAGE_PIXELS, 100)

  expect(
    await shrunkImage(new File([source], 'fits.png', source))
  ).toBeUndefined()
})

it('leaves alone a file that says it is an image and can’t be decoded', async () => {
  const broken = new File(['Not an image'], 'broken.png', {type: 'image/png'})

  expect(await shrunkImage(broken)).toBeUndefined()
})

it('never decodes a file that is no image', async () => {
  const source = await image('image/png', INLINE_IMAGE_PIXELS * 2, 10)
  const mislabeled = new File([source], 'data.bin', {type: ''})

  expect(await shrunkImage(mislabeled)).toBeUndefined()
})
