function uint16(value: number) {
  return [Math.floor(value / 256), value % 256]
}

const START_OF_IMAGE = [0xff, 0xd8]

const JFIF = [
  0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
]

const END_OF_IMAGE = [0xff, 0xd9]

const COMPONENTS = [1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]

/** A JFIF JPEG's headers and a baseline frame: enough to read its size. */
export function jpegBytes(width: number, height: number, size?: number) {
  const frame = [0xff, 0xc0, 0, 17, 8, ...uint16(height), ...uint16(width), 3]

  const header = [
    ...START_OF_IMAGE,
    ...JFIF,
    ...frame,
    ...COMPONENTS,
    ...END_OF_IMAGE,
  ]

  const bytes = new Uint8Array(size ?? header.length)
  bytes.set(header)

  return bytes
}

export function pngBytes() {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
  ])
}
