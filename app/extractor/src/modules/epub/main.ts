import type {Zip} from '#modules/zip/main'

import {decodeText, elements, parseXml} from '#modules/xml/main'
import {resolveEntry} from '#modules/zip/main'

const CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container'
const OPF = 'http://www.idpf.org/2007/opf'

/** HTML's white space: `\s` would also take the no-break space. */
const SPACE = /[ \t\n\r\f]+/g
const EDGE_SPACE = /^[ \t\n\r\f]+|[ \t\n\r\f]+$/g

const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
])

const SKIPPED = new Set(['head', 'script', 'style', 'noscript', 'template'])

function folderOf(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

function decodeHref(href: string) {
  const path = href.split('#')[0] ?? ''

  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function spine(zip: Zip) {
  const container = zip.read('META-INF/container.xml')

  const opfPath = container
    ? elements(parseXml(container), CONTAINER, 'rootfile')[0]?.getAttribute(
        'full-path'
      )
    : null

  const opf = opfPath ? zip.read(opfPath) : null

  if (!opfPath || !opf) throw new Error('The epub has no package document.')
  const book = parseXml(opf)

  const items = new Map(
    elements(book, OPF, 'item').map(item => [
      item.getAttribute('id'),
      resolveEntry(
        folderOf(opfPath),
        decodeHref(item.getAttribute('href') ?? '')
      ),
    ])
  )

  return elements(book, OPF, 'itemref').flatMap(ref => {
    const entry = items.get(ref.getAttribute('idref'))

    return entry === undefined ? [] : [entry]
  })
}

/** XHTML as XML first; an HTML entity such as `&nbsp;` needs the HTML parser. */
function parseChapter(bytes: Uint8Array) {
  try {
    return parseXml(bytes)
  } catch {
    return new DOMParser().parseFromString(decodeText(bytes), 'text/html')
  }
}

function blockText(node: Node, inPre: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''

    return inPre ? text : text.replaceAll(SPACE, ' ')
  }

  if (!(node instanceof Element)) return ''
  const name = node.localName.toLowerCase()

  if (SKIPPED.has(name)) return ''

  if (name === 'br') return '\n'

  const inner = [...node.childNodes]
    .map(child => blockText(child, inPre || name === 'pre'))
    .join('')

  if (name === 'td' || name === 'th') return `${inner}\t`

  return BLOCKS.has(name) ? `\n${inner}\n` : inner
}

function chapterText(bytes: Uint8Array) {
  const document = parseChapter(bytes)

  const body =
    [...document.getElementsByTagName('*')].find(
      element => element.localName.toLowerCase() === 'body'
    ) ?? document.documentElement

  return blockText(body, false)
    .split('\n')
    .map(line => line.replaceAll(EDGE_SPACE, ''))
    .filter(line => line !== '')
    .join('\n')
}

export function readEpub(zip: Zip) {
  return spine(zip)
    .flatMap(entry => {
      const bytes = zip.read(entry)
      const text = bytes ? chapterText(bytes) : ''

      return text ? [text] : []
    })
    .join('\n\n')
}
