/** In PDF points, from the page's bottom-left corner. */
export interface TestImage {
  x: number
  y: number
  w: number
  h: number
}

export interface TestPage {
  text?: string
  images?: TestImage[]
}

interface Options {
  width?: number
  height?: number
  /** Locked with a user password, so no reader opens it without one. */
  encrypted?: boolean
}

const PIXELS = String.fromCodePoint(
  255,
  0,
  0,
  0,
  255,
  0,
  0,
  0,
  255,
  255,
  255,
  0
)

function contentOf({text, images = []}: TestPage) {
  let ops = ''

  for (const {x, y, w, h} of images)
    ops += `q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q\n`

  if (text !== undefined) ops += `BT /F1 12 Tf 10 20 Td (${text}) Tj ET\n`

  return `<< /Length ${ops.length} >>\nstream\n${ops}endstream`
}

function serialize(objects: string[], trailer: string) {
  let out = '%PDF-1.4\n'

  const offsets = objects.map((body, index) => {
    const at = out.length
    out += `${index + 1} 0 obj\n${body}\nendobj\n`

    return at
  })

  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`

  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`

  return new Uint8Array(Buffer.from(out, 'latin1'))
}

/**
 * A PDF written by hand, with no dependency. Each image is a 2×2 bitmap
 * stretched over its box; text is one line of Helvetica.
 */
export function testPdf(
  pages: TestPage[],
  {width = 200, height = 100, encrypted = false}: Options = {}
) {
  const objects: string[] = []

  function add(body: string) {
    return objects.push(body)
  }

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>')
  const tree = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const image = add(
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${PIXELS.length} >>\nstream\n${PIXELS}\nendstream`
  )

  const kids = pages.map(page => {
    const content = add(contentOf(page))

    return add(
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im0 ${image} 0 R >> >> >>`
    )
  })

  objects[tree - 1] =
    `<< /Type /Pages /Kids [${kids.map(kid => `${kid} 0 R`).join(' ')}] /Count ${kids.length} >>`

  if (!encrypted) return serialize(objects, `/Root ${catalog} 0 R`)

  const lock = add(
    `<< /Filter /Standard /V 1 /R 2 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -4 >>`
  )

  const id = '01'.repeat(16)

  return serialize(
    objects,
    `/Root ${catalog} 0 R /Encrypt ${lock} 0 R /ID [<${id}> <${id}>]`
  )
}
