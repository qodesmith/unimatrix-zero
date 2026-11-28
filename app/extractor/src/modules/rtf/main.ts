import {tidyLines} from '#modules/xml/main'

const SIGNATURE = '{\\rtf'

const HIDDEN = new Set([
  'annotation',
  'colorschememapping',
  'colortbl',
  'datastore',
  'fldinst',
  'fonttbl',
  'footer',
  'footerf',
  'footerl',
  'footerr',
  'footnote',
  'generator',
  'header',
  'headerf',
  'headerl',
  'headerr',
  'info',
  'latentstyles',
  'listoverridetable',
  'listtable',
  'nonshppict',
  'object',
  'pict',
  'revtbl',
  'rsidtbl',
  'stylesheet',
  'themedata',
  'xmlnstbl',
])

const WORDS = new Map([
  ['par', '\n'],
  ['line', '\n'],
  ['sect', '\n'],
  ['page', '\n'],
  ['row', '\n'],
  ['tab', '\t'],
  ['cell', '\t'],
  ['emdash', '—'],
  ['endash', '–'],
  ['bullet', '•'],
  ['lquote', '‘'],
  ['rquote', '’'],
  ['ldblquote', '“'],
  ['rdblquote', '”'],
  ['emspace', ' '],
  ['enspace', ' '],
])

const SYMBOLS = new Map([
  ['\\', '\\'],
  ['{', '{'],
  ['}', '}'],
  ['~', '\u00a0'],
  ['_', '-'],
  ['\n', '\n'],
  ['\r', '\n'],
])

const CONTROL_WORD = /([a-z]+)(-?\d+)? ?/iy

interface Group {
  hidden: boolean
  fallback: number
}

interface Reader {
  source: string
  at: number
  group: Group
  stack: Group[]
  text: string
  dropping: number
}

const cp1252 = new TextDecoder('windows-1252')

export function isRtf(bytes: Uint8Array) {
  return cp1252.decode(bytes.subarray(0, SIGNATURE.length)) === SIGNATURE
}

function emit(reader: Reader, text: string) {
  if (reader.dropping > 0) {
    reader.dropping--

    return
  }

  if (!reader.group.hidden) reader.text += text
}

function controlWord(reader: Reader, word: string, parameter: number | null) {
  if (HIDDEN.has(word)) reader.group.hidden = true
  else if (word === 'uc') reader.group.fallback = parameter ?? 1
  else if (word === 'u' && parameter !== null) {
    if (!reader.group.hidden)
      reader.text += String.fromCharCode(
        parameter < 0 ? parameter + 65_536 : parameter
      )
    reader.dropping = reader.group.fallback
  } else if (word === 'bin') reader.at += Math.max(parameter ?? 0, 0)
  else {
    const text = WORDS.get(word)

    if (text !== undefined) emit(reader, text)
  }
}

function control(reader: Reader) {
  const {source} = reader
  const next = source.charAt(reader.at + 1)

  if (next === "'") {
    const byte = Number.parseInt(source.slice(reader.at + 2, reader.at + 4), 16)

    reader.at += 4

    if (!Number.isNaN(byte)) emit(reader, cp1252.decode(Uint8Array.of(byte)))

    return
  }

  CONTROL_WORD.lastIndex = reader.at + 1
  const match = CONTROL_WORD.exec(source)

  if (match?.[1] === undefined) {
    reader.at += 2

    if (next === '*') reader.group.hidden = true
    else emit(reader, SYMBOLS.get(next) ?? '')

    return
  }

  reader.at = CONTROL_WORD.lastIndex
  controlWord(
    reader,
    match[1],
    match[2] === undefined ? null : Number(match[2])
  )
}

function step(reader: Reader) {
  const char = reader.source.charAt(reader.at)

  switch (char) {
    case '{':
      reader.stack.push(reader.group)
      reader.group = {...reader.group}
      reader.at++
      break
    case '}':
      reader.group = reader.stack.pop() ?? reader.group
      reader.dropping = 0
      reader.at++
      break
    case '\\':
      control(reader)
      break
    case '\r':
    case '\n':
      reader.at++
      break
    default:
      emit(reader, char)
      reader.at++
  }
}

export function readRtf(bytes: Uint8Array) {
  const reader: Reader = {
    source: cp1252.decode(bytes),
    at: 0,
    group: {hidden: false, fallback: 1},
    stack: [],
    text: '',
    dropping: 0,
  }

  while (reader.at < reader.source.length) step(reader)

  return tidyLines([reader.text])
}
