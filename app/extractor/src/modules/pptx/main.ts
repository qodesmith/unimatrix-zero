import type {Zip} from '#modules/zip/main'

import {elements, parseXml, tidyLines} from '#modules/xml/main'

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/

function paragraphText(paragraph: Element) {
  let text = ''

  for (const node of elements(paragraph, DRAWING, '*'))
    if (node.localName === 't') text += node.textContent
    else if (node.localName === 'br') text += '\n'

  return text
}

export function readPptx(zip: Zip) {
  const slides = zip
    .names()
    .map(name => ({name, number: Number(SLIDE.exec(name)?.[1] ?? Number.NaN)}))
    .filter(slide => !Number.isNaN(slide.number))
    .toSorted((a, b) => a.number - b.number)
    .map(({name}, index) => {
      const part = zip.read(name)

      const paragraphs = part
        ? elements(parseXml(part), DRAWING, 'p').map(paragraphText)
        : []

      return [`--- Slide ${index + 1} ---`, ...paragraphs].join('\n')
    })

  return tidyLines([slides.join('\n\n')])
}
