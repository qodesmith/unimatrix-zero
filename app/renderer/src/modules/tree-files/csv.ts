interface Reading {
  rows: string[][]
  row: string[]
  field: string
  quoted: boolean
}

function endField(reading: Reading) {
  reading.row.push(reading.field)
  reading.field = ''
}

function endRow(reading: Reading) {
  endField(reading)
  reading.rows.push(reading.row)
  reading.row = []
}

/** One character inside quotes; returns how many it used. */
function readQuoted(reading: Reading, text: string, at: number) {
  const char = text.charAt(at)

  if (char !== '"') {
    reading.field += char

    return 1
  }

  if (text[at + 1] === '"') {
    reading.field += '"'

    return 2
  }

  reading.quoted = false

  return 1
}

/** RFC 4180: a quoted field holds the delimiter, newlines and doubled quotes. */
export function parseDelimited(text: string, delimiter: ',' | '\t') {
  const reading: Reading = {rows: [], row: [], field: '', quoted: false}
  let at = 0

  while (at < text.length) {
    const char = text.charAt(at)

    if (reading.quoted) {
      at += readQuoted(reading, text, at)
      continue
    }

    if (char === '"' && reading.field === '') reading.quoted = true
    else if (char === delimiter) endField(reading)
    else if (char === '\n') endRow(reading)
    else if (char !== '\r' || text[at + 1] !== '\n') reading.field += char

    at += 1
  }

  if (reading.field !== '' || reading.row.length > 0 || reading.quoted) {
    endRow(reading)
  }

  return reading.rows
}
