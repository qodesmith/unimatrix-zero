const MARKER = 0xff

const START_OF_SCAN = 0xda

/** Markers with no length after them: TEM and RST0–RST7. */
function standsAlone(marker: number) {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
}

/** SOF0–SOF15, less DHT, JPG and DAC, which share the range. */
function isStartOfFrame(marker: number) {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  )
}

function uint16(bytes: Uint8Array, at: number) {
  const high = bytes[at]
  const low = bytes[at + 1]

  return high === undefined || low === undefined ? null : high * 256 + low
}

/** A frame header: its length, precision, height, width, then components. */
const FRAME_HEADER_LENGTH = 11

function frameSize(bytes: Uint8Array, at: number, length: number) {
  if (length < FRAME_HEADER_LENGTH) return null

  const height = uint16(bytes, at + 3)
  const width = uint16(bytes, at + 5)

  return height === null || width === null ? null : {width, height}
}

/**
 * Walks the marker segments to the first frame header. Null when the bytes
 * are not a JPEG or end before it.
 */
export function jpegSize(bytes: Uint8Array) {
  if (bytes[0] !== MARKER || bytes[1] !== 0xd8 || bytes[2] !== MARKER) {
    return null
  }

  let at = 2

  while (at < bytes.byteLength) {
    if (bytes[at] !== MARKER) return null

    while (bytes[at] === MARKER) at += 1

    const marker = bytes[at]

    if (marker === undefined || marker === START_OF_SCAN) return null

    at += 1

    if (standsAlone(marker)) continue

    const length = uint16(bytes, at)

    if (length === null || length < 2 || at + length > bytes.byteLength) {
      return null
    }

    if (isStartOfFrame(marker)) return frameSize(bytes, at, length)

    at += length
  }

  return null
}
