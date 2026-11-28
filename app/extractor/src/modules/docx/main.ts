import type {Zip} from '#modules/zip/main'

import {elements, parseXml, tidyLines} from '#modules/xml/main'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function paragraphText(node: Element): string {
  let text = ''

  for (const child of node.children) {
    if (child.namespaceURI !== W) continue

    switch (child.localName) {
      case 'p':
      case 'pPr':
      case 'rPr':
        break
      case 't':
        text += child.textContent
        break
      case 'tab':
        text += '\t'
        break
      case 'br':
      case 'cr':
        text += '\n'
        break
      default:
        text += paragraphText(child)
    }
  }

  return text
}

export function readDocx(zip: Zip) {
  const part = zip.read('word/document.xml')

  if (!part) throw new Error('The docx has no document part.')

  return tidyLines(elements(parseXml(part), W, 'p').map(paragraphText))
}
