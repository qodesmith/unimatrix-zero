import type {Zip} from '#modules/zip/main'
import type {ExtractionFormat} from '@uz/contract/extraction'

import {elements, parseXml, tidyLines} from '#modules/xml/main'

const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'

const PRESENTATION = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'

const REPEAT_LIMIT = 100

export type OdfKind = Extract<ExtractionFormat, 'odt' | 'ods' | 'odp'>

function paragraphText(node: Element): string {
  let text = ''

  for (const child of node.childNodes)
    if (child.nodeType === Node.TEXT_NODE)
      text += (child.textContent ?? '').replaceAll(/\s+/g, ' ')
    else if (child instanceof Element) text += inlineText(child)

  return text
}

function inlineText(element: Element) {
  if (element.namespaceURI !== TEXT) return paragraphText(element)

  switch (element.localName) {
    case 'p':
    case 'h':
      return ''
    case 's':
      return ' '.repeat(repeats(element, TEXT, 'c'))
    case 'tab':
      return '\t'
    case 'line-break':
      return '\n'
    default:
      return paragraphText(element)
  }
}

function repeats(element: Element, ns: string, name: string) {
  const count = Number(element.getAttributeNS(ns, name) ?? 1)

  return Number.isInteger(count) && count > 0
    ? Math.min(count, REPEAT_LIMIT)
    : 1
}

function paragraphs(root: Document | Element) {
  return elements(root, TEXT, '*').filter(
    node => node.localName === 'p' || node.localName === 'h'
  )
}

function inNotes(node: Element) {
  for (let at = node.parentElement; at; at = at.parentElement)
    if (at.namespaceURI === PRESENTATION && at.localName === 'notes')
      return true

  return false
}

function slides(content: Document) {
  return elements(content, DRAW, 'page')
    .map((page, index) => {
      const lines = paragraphs(page)
        .filter(paragraph => !inNotes(paragraph))
        .map(paragraphText)

      return [`--- Slide ${index + 1} ---`, ...lines].join('\n')
    })
    .join('\n\n')
}

function rowCells(row: Element) {
  const cells: string[] = []

  for (const cell of row.children) {
    if (cell.namespaceURI !== TABLE || !cell.localName.endsWith('table-cell'))
      continue
    const text = paragraphs(cell).map(paragraphText).join('\n')

    for (let n = repeats(cell, TABLE, 'number-columns-repeated'); n > 0; n--)
      cells.push(text)
  }

  return cells.join('\t').trimEnd()
}

function sheetRows(table: Element) {
  const rows: string[] = []

  for (const row of elements(table, TABLE, 'table-row')) {
    const text = rowCells(row)
    const times = text ? repeats(row, TABLE, 'number-rows-repeated') : 1

    for (let n = times; n > 0; n--) rows.push(text)
  }

  while (rows.at(-1) === '') rows.pop()

  return rows
}

function sheets(content: Document) {
  return elements(content, TABLE, 'table')
    .map(table =>
      [
        `--- Sheet: ${table.getAttributeNS(TABLE, 'name') ?? ''} ---`,
        ...sheetRows(table),
      ].join('\n')
    )
    .join('\n\n')
}

const READERS: Record<OdfKind, (content: Document) => string[]> = {
  odt: content => paragraphs(content).map(paragraphText),
  odp: content => [slides(content)],
  ods: content => [sheets(content)],
}

export function readOdf(zip: Zip, kind: OdfKind) {
  const part = zip.read('content.xml')

  if (!part) throw new Error('The file has no content part.')
  const content = parseXml(part)

  return tidyLines(READERS[kind](content))
}
