export const MIB = 1024 * 1024

const UNITS = ['KiB', 'MiB', 'GiB']

function rounded(value: number) {
  return value < 10 ? value.toFixed(1).replace(/\.0$/u, '') : Math.round(value)
}

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
