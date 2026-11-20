import {
  ATTACHMENT_SIZE_LIMIT,
  INLINE_IMAGE_PIXELS,
  INLINE_IMAGE_SIZE_LIMIT,
} from '@uz/contract/attachments'

const JPEG_QUALITY = 0.85

async function encoded(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg'
) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')

  if (!context) return null

  if (type === 'image/jpeg') {
    // JPEG has no transparency, and a clear pixel would come out black.
    // oxlint-disable-next-line uz/no-hardcoded-colors -- the image's own background, not the app's
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
  }

  context.drawImage(bitmap, 0, 0, width, height)

  const blob = await canvas.convertToBlob({type, quality: JPEG_QUALITY})

  // A canvas that can't encode the type asked for answers with a PNG.
  return blob.type === type && blob.size <= INLINE_IMAGE_SIZE_LIMIT
    ? blob
    : null
}

async function shrunk(file: File, bitmap: ImageBitmap) {
  const longSide = Math.max(bitmap.width, bitmap.height)

  if (longSide <= INLINE_IMAGE_PIXELS && file.size <= INLINE_IMAGE_SIZE_LIMIT) {
    return undefined
  }

  const scale = Math.min(1, INLINE_IMAGE_PIXELS / longSide)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const blob =
    (file.type === 'image/png'
      ? await encoded(bitmap, width, height, 'image/png')
      : null) ?? (await encoded(bitmap, width, height, 'image/jpeg'))

  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}

/**
 * The smaller copy of an image over `INLINE_IMAGE_PIXELS` or
 * `INLINE_IMAGE_SIZE_LIMIT`, for main to send inline in the original's place.
 * Undefined for an image that fits as it is, for any other file, and for an
 * image that can't be decoded or encoded: it attaches all the same.
 */
export async function shrunkImage(file: File) {
  if (!file.type.startsWith('image/') || file.size > ATTACHMENT_SIZE_LIMIT) {
    return undefined
  }

  try {
    const bitmap = await createImageBitmap(file)

    try {
      return await shrunk(file, bitmap)
    } finally {
      bitmap.close()
    }
  } catch {
    return undefined
  }
}
