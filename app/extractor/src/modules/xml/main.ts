const XHTML = 'http://www.w3.org/1999/xhtml'

export function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes)

  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes)

  return new TextDecoder().decode(bytes)
}

export function parseXml(bytes: Uint8Array) {
  const document = new DOMParser().parseFromString(
    decodeText(bytes),
    'application/xml'
  )

  if (document.getElementsByTagNameNS(XHTML, 'parsererror').length > 0)
    throw new Error('A part of the file is not well-formed XML.')

  return document
}

export function elements(root: Document | Element, ns: string, name: string) {
  return [...root.getElementsByTagNameNS(ns, name)]
}

export function childElements(root: Element, ns: string, name: string) {
  return [...root.children].filter(
    child => child.namespaceURI === ns && child.localName === name
  )
}

/** Each line trimmed at its end, and the blank lines at either end dropped. */
export function tidyLines(lines: string[]) {
  return lines
    .join('\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replaceAll(/^\n+|\n+$/g, '')
}
