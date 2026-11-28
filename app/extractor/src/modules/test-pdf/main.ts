interface Placement {
  x: number
  y: number
  width: number
  height: number
}

export interface TestPage {
  lines?: string[]
  images?: Placement[]
  formScale?: number
}

export const PAGE = {width: 612, height: 792}

export async function makeJpeg(width = 64, height = 48) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')

  if (!context) throw new Error('no 2d context')
  context.fillStyle = '#c00'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#00c'
  context.fillRect(0, 0, width / 2, height / 2)
  const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9})

  return {bytes: new Uint8Array(await blob.arrayBuffer()), width, height}
}

function escape(text: string) {
  return text.replaceAll(/[\\()]/g, char => `\\${char}`)
}

function imagesOf(page: TestPage) {
  return (page.images ?? [])
    .map(
      ({x, y, width, height}) =>
        `q ${width} 0 0 ${height} ${x} ${y} cm /Im1 Do Q`
    )
    .join('\n')
}

function contentOf(page: TestPage) {
  const text = (page.lines ?? []).map(
    (line, index) =>
      `BT /F1 12 Tf 72 ${720 - index * 16} Td (${escape(line)}) Tj ET`
  )

  const images = page.formScale === undefined ? imagesOf(page) : '/Fm1 Do'

  return [...text, images].join('\n')
}

export function makePdf(
  pages: TestPage[],
  jpeg: {bytes: Uint8Array; width: number; height: number}
) {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0

  function writeBytes(bytes: Uint8Array) {
    parts.push(bytes)
    length += bytes.length
  }

  function write(text: string) {
    writeBytes(encoder.encode(text))
  }

  function object(body: string, stream?: Uint8Array) {
    offsets.push(length)
    write(`${offsets.length} 0 obj\n${body}\n`)

    if (stream) {
      write('stream\n')
      writeBytes(stream)
      write('\nendstream\n')
    }

    write('endobj\n')
  }

  const firstPage = 5
  const kids = pages.map((_, index) => `${firstPage + index * 3} 0 R`)

  write('%PDF-1.7\n%âã\n')
  object('<< /Type /Catalog /Pages 2 0 R >>')
  object(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`)
  object('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  object(
    `<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bytes.length} >>`,
    jpeg.bytes
  )

  for (const [index, page] of pages.entries()) {
    const content = encoder.encode(contentOf(page))
    const form = encoder.encode(imagesOf(page))
    const scale = page.formScale ?? 1
    const pageObject = firstPage + index * 3

    object(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R /Fm1 ${pageObject + 2} 0 R >> >> /Contents ${pageObject + 1} 0 R >>`
    )
    object(`<< /Length ${content.length} >>`, content)
    object(
      `<< /Type /XObject /Subtype /Form /BBox [0 0 ${PAGE.width} ${PAGE.height}] /Matrix [${scale} 0 0 ${scale} 0 0] /Resources << /XObject << /Im1 4 0 R >> >> /Length ${form.length} >>`,
      form
    )
  }

  const xref = length

  write(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`)

  for (const offset of offsets)
    write(`${String(offset).padStart(10, '0')} 00000 n \n`)
  write(
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  )

  const pdf = new Uint8Array(length)
  let at = 0

  for (const part of parts) {
    pdf.set(part, at)
    at += part.length
  }

  return pdf
}
