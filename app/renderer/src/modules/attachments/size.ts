const UNITS = ['KB', 'MB', 'GB']

function rounded(value: number) {
  return value < 10 ? value.toFixed(1).replace(/\.0$/u, '') : Math.round(value)
}

/** A file's size as a chip shows it: 512 bytes, 2.4 KB, 18 MB. */
export function formatSize(bytes: number) {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`

  let value = bytes / 1024
  let unit = 0

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${rounded(value)} ${UNITS[unit]}`
}
