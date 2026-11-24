import type {Zip} from '#modules/zip/main'

import {childElements, elements, parseXml, tidyLines} from '#modules/xml/main'
import {resolveEntry} from '#modules/zip/main'

const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

const RELS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const PACKAGE_RELS =
  'http://schemas.openxmlformats.org/package/2006/relationships'

/** Leaves out `rPh`, the phonetic reading printed beside Japanese text. */
function richText(node: Element) {
  return [
    ...childElements(node, SHEET, 't'),
    ...childElements(node, SHEET, 'r').flatMap(run =>
      childElements(run, SHEET, 't')
    ),
  ]
    .map(t => t.textContent)
    .join('')
}

function sharedStrings(zip: Zip) {
  const part = zip.read('xl/sharedStrings.xml')

  if (!part) return []

  return elements(parseXml(part), SHEET, 'si').map(richText)
}

function sheetParts(zip: Zip) {
  const workbook = zip.read('xl/workbook.xml')
  const rels = zip.read('xl/_rels/workbook.xml.rels')

  if (!workbook || !rels) throw new Error('The xlsx has no workbook.')

  const targets = new Map(
    elements(parseXml(rels), PACKAGE_RELS, 'Relationship').map(rel => [
      rel.getAttribute('Id'),
      resolveEntry('xl/', rel.getAttribute('Target') ?? ''),
    ])
  )

  return elements(parseXml(workbook), SHEET, 'sheet').map(sheet => ({
    name: sheet.getAttribute('name') ?? '',
    part: targets.get(sheet.getAttributeNS(RELS, 'id')),
  }))
}

function columnOf(reference: string | null) {
  const letters = /^[A-Z]+/.exec(reference ?? '')?.[0]

  if (letters === undefined) return null
  let column = 0

  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64

  return column - 1
}

function cellValue(cell: Element, shared: string[]) {
  const value = childElements(cell, SHEET, 'v')[0]?.textContent ?? ''

  switch (cell.getAttribute('t') ?? '') {
    case 's':
      return shared[Number(value)] ?? ''
    case 'inlineStr':
      return childElements(cell, SHEET, 'is')
        .map(is => richText(is))
        .join('')
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE'
    default:
      return value
  }
}

function rowText(row: Element, shared: string[]) {
  const cells: string[] = []

  for (const cell of childElements(row, SHEET, 'c')) {
    const column = columnOf(cell.getAttribute('r')) ?? cells.length

    while (cells.length < column) cells.push('')
    cells[column] = cellValue(cell, shared)
  }

  return cells.join('\t')
}

export function readXlsx(zip: Zip) {
  const shared = sharedStrings(zip)

  const sheets = sheetParts(zip).map(({name, part}) => {
    const bytes = part === undefined ? null : zip.read(part)

    const rows = bytes
      ? elements(parseXml(bytes), SHEET, 'row').map(row => rowText(row, shared))
      : []

    return [`--- Sheet: ${name} ---`, ...rows].join('\n')
  })

  return tidyLines([sheets.join('\n\n')])
}
