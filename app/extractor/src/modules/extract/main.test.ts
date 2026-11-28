import {PAGE, makeJpeg, makePdf} from '#modules/test-pdf/main'
import {MIB} from '@uz/contract/sizes'
import {strToU8, zipSync} from 'fflate'
import {describe, expect, it} from 'vitest'

import {extract} from './main'

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

const RELS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'

const ODF_NAMESPACES = [
  'office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
]
  .map(ns => `xmlns:${ns}`)
  .join(' ')

function odf(kind: string, body: string) {
  return zipSync({
    mimetype: [
      strToU8(`application/vnd.oasis.opendocument.${kind}`),
      {level: 0},
    ],
    'content.xml': strToU8(
      `<office:document-content ${ODF_NAMESPACES}><office:body>${body}</office:body></office:document-content>`
    ),
  })
}

function slide(...paragraphs: string[]) {
  return strToU8(
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${DRAWING}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs
      .map(p => `<a:p>${p}</a:p>`)
      .join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  )
}

function chapter(body: string) {
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Skip me</title><style>p{}</style></head><body>${body}</body></html>`
  )
}

const DOCUMENT = 'word/document.xml'

function bareDocx(body: Uint8Array, level: 0 | 9 = 9) {
  return zipSync({[DOCUMENT]: [body, {level}]})
}

function centralRecord(zip: Uint8Array, name: string) {
  const data = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)

  for (let at = 0; at < zip.length - 46; at++) {
    if (data.getUint32(at, true) !== 0x02_01_4b_50) continue
    const length = data.getUint16(at + 28, true)
    const found = zip.subarray(at + 46, at + 46 + length)

    if (new TextDecoder().decode(found) === name) return {data, at}
  }

  throw new Error(`no entry ${name}`)
}

function patch(
  zip: Uint8Array,
  name: string,
  fields: {flags?: number; method?: number; size?: number}
) {
  const {data, at} = centralRecord(zip, name)

  if (fields.flags !== undefined) data.setUint16(at + 8, fields.flags, true)

  if (fields.method !== undefined) data.setUint16(at + 10, fields.method, true)

  if (fields.size !== undefined) data.setUint32(at + 24, fields.size, true)

  return zip
}

function compressedSize(zip: Uint8Array, name: string) {
  const {data, at} = centralRecord(zip, name)

  return data.getUint32(at + 20, true)
}

async function failure(bytes: Uint8Array) {
  const output = await extract(bytes)

  if (output.type !== 'failed')
    throw new Error(`expected failed, got ${output.type}`)

  return output.message
}

async function readText(bytes: Uint8Array) {
  const output = await extract(bytes)

  if (output.type !== 'read')
    throw new Error(`expected read, got ${output.type}`)

  return {...output, text: new TextDecoder().decode(output.text)}
}

describe('extract', () => {
  it('reads a docx: a line per paragraph, with its tabs and breaks', async () => {
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        `<w:document ${W}><w:body>
          <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>
            <w:r><w:t>Hello</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">big </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>
          <w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t></w:r></w:p>
        </w:body></w:document>`
      ),
    })

    const output = await readText(docx)

    expect(output).toMatchObject({
      format: 'docx',
      pageImages: [],
      imagesStopped: false,
    })
    expect(output.text).toBe('Hello\tbig world\none\ntwo')
  })

  it('reads an xlsx: each sheet by its name, cells tab-separated in their columns', async () => {
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(
        `<workbook xmlns="${SHEET}" xmlns:r="${RELS}"><sheets>
          <sheet name="Totals" sheetId="2" r:id="rId2"/>
          <sheet name="Data" sheetId="1" r:id="rId1"/>
        </sheets></workbook>`
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/>
        </Relationships>`
      ),
      'xl/sharedStrings.xml': strToU8(
        `<sst xmlns="${SHEET}"><si><t>Name</t></si><si><r><t>Ada </t></r><r><t>Lovelace</t></r></si></sst>`
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        `<worksheet xmlns="${SHEET}"><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Born</t></is></c></row>
          <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>36</v></c><c r="C2" t="str"><f>X</f><v>1815</v></c></row>
        </sheetData></worksheet>`
      ),
      'xl/worksheets/sheet2.xml': strToU8(
        `<worksheet xmlns="${SHEET}"><sheetData><row r="1"><c r="B1"><v>42</v></c></row></sheetData></worksheet>`
      ),
    })

    const output = await readText(xlsx)

    expect(output.format).toBe('xlsx')
    expect(output.text).toBe(
      '--- Sheet: Totals ---\n\t42\n\n--- Sheet: Data ---\nName\t\tBorn\nAda Lovelace\t36\t1815'
    )
  })

  it('reads a pptx: its slides in numeric order, a line per paragraph', async () => {
    const pptx = zipSync({
      'ppt/presentation.xml': strToU8('<presentation/>'),
      'ppt/slides/slide10.xml': slide('<a:r><a:t>Last</a:t></a:r>'),
      'ppt/slides/slide2.xml': slide(
        '<a:r><a:t>Second </a:t></a:r><a:r><a:t>slide</a:t></a:r>',
        '<a:r><a:t>up</a:t></a:r><a:br/><a:r><a:t>down</a:t></a:r>'
      ),
      'ppt/slides/slide1.xml': slide('<a:r><a:t>Title</a:t></a:r>'),
      'ppt/slides/_rels/slide1.xml.rels': strToU8('<Relationships/>'),
    })

    const output = await readText(pptx)

    expect(output.format).toBe('pptx')
    expect(output.text).toBe(
      '--- Slide 1 ---\nTitle\n\n--- Slide 2 ---\nSecond slide\nup\ndown\n\n--- Slide 3 ---\nLast'
    )
  })

  it('reads an odt: headings and paragraphs, each on its own line', async () => {
    const odt = odf(
      'text',
      `<office:text>
        <text:h>Heading</text:h>
        <text:p>One<text:s text:c="2"/>two<text:tab/><text:span>three</text:span></text:p>
        <text:list><text:list-item><text:p>item<text:line-break/>next</text:p></text:list-item></text:list>
      </office:text>`
    )

    const output = await readText(odt)

    expect(output.format).toBe('odt')
    expect(output.text).toBe('Heading\nOne  two\tthree\nitem\nnext')
  })

  it('reads an epub: its spine in order, block elements on their own lines', async () => {
    const epub = zipSync({
      mimetype: [strToU8('application/epub+zip'), {level: 0}],
      'META-INF/container.xml': strToU8(
        `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
      ),
      'OEBPS/content.opf': strToU8(
        `<package xmlns="http://www.idpf.org/2007/opf"><manifest>
          <item id="a" href="text/one.xhtml"/><item id="b" href="text/two%20b.xhtml"/><item id="css" href="style.css"/>
        </manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`
      ),
      'OEBPS/text/one.xhtml': chapter(
        '<h1>Chapter  one</h1><p>It was <em>a</em>\n dark night.</p><ul><li>first</li><li>second</li></ul>'
      ),
      'OEBPS/text/two b.xhtml': chapter(
        '<p>Preface&nbsp;text<br/>next line</p><script>bad()</script>'
      ),
    })

    const output = await readText(epub)

    expect(output.format).toBe('epub')
    expect(output.text).toBe(
      'Preface\u00a0text\nnext line\n\nChapter one\nIt was a dark night.\nfirst\nsecond'
    )
  })

  it('reads an odp: each page as a slide, leaving out its speaker notes', async () => {
    const odp = odf(
      'presentation',
      `<office:presentation>
        <draw:page><draw:frame><draw:text-box><text:p>Welcome</text:p></draw:text-box></draw:frame>
          <presentation:notes><draw:frame><draw:text-box><text:p>say hi</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>
        <draw:page><draw:frame><draw:text-box><text:p>Bye</text:p></draw:text-box></draw:frame></draw:page>
      </office:presentation>`
    )

    const output = await readText(odp)

    expect(output.format).toBe('odp')
    expect(output.text).toBe('--- Slide 1 ---\nWelcome\n\n--- Slide 2 ---\nBye')
  })

  it('reads an ods: each table as a sheet, repeats capped and empty repeats free', async () => {
    const ods = odf(
      'spreadsheet',
      `<office:spreadsheet>
        <table:table table:name="Budget">
          <table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value="3"><text:p>3</text:p></table:table-cell></table:table-row>
          <table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
          <table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell></table:table-row>
          <table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="1000000"><text:p>y</text:p></table:table-cell></table:table-row>
          <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
        </table:table>
        <table:table table:name="Empty"/>
      </office:spreadsheet>`
    )

    const output = await readText(ods)
    const lines = output.text.split('\n')

    expect(output.format).toBe('ods')
    expect(lines.slice(0, 5)).toEqual([
      '--- Sheet: Budget ---',
      'Item\t\t\t3',
      '',
      'x\tx',
      'x\tx',
    ])
    expect(lines[5]?.split('\t')).toHaveLength(100)
    expect(lines.filter(line => line.startsWith('y'))).toHaveLength(100)
    expect(lines.slice(-2)).toEqual(['', '--- Sheet: Empty ---'])
  })

  it('reads an rtf: text and breaks, with the tables, pictures and hidden groups left out', async () => {
    const rtf = strToU8(
      [
        '{|rtf1|ansi|ansicpg1252|deff0{|fonttbl{|f0|fswiss Helvetica;}}',
        '{|colortbl;|red0|green0|blue0;}{|stylesheet{|s0 Normal;}}',
        '{|info{|title Secret}{|author Someone}}{|*|generator Writer 1.0;}',
        '{|header Page header|par}',
        "|pard|plain|f0 Caf|'e9 costs |u8364?5 or |uc2|u8364|'80|'80 6.|par",
        'Tab|tab here|line next |{braces|} and || slash|par',
        '{|pict|pngblip 89504e47}{|b Bold} end|par}',
      ]
        .join('\r\n')
        .replaceAll('|', '\\')
    )

    const output = await readText(rtf)

    expect(output.format).toBe('rtf')
    expect(output.text).toBe(
      'Café costs €5 or € 6.\nTab\there\nnext {braces} and \\ slash\nBold end'
    )
  })

  it('reads an ipynb: each cell in order, code fenced in its language and followed by its text output', async () => {
    const notebook = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {language_info: {name: 'python'}},
      cells: [
        {cell_type: 'markdown', source: ['# Title\n', 'Some *text*']},
        {
          cell_type: 'code',
          source: 'print(1)\n1 + 1',
          outputs: [
            {output_type: 'stream', name: 'stdout', text: ['1\n']},
            {
              output_type: 'execute_result',
              data: {'text/plain': ['2'], 'image/png': 'iVBOR'},
            },
            {output_type: 'display_data', data: {'image/png': 'iVBOR'}},
          ],
        },
        {cell_type: 'raw', source: 'raw text'},
      ],
    }

    const output = await readText(strToU8(` ${JSON.stringify(notebook)}`))

    expect(output.format).toBe('ipynb')
    expect(output.text).toBe(
      '# Title\nSome *text*\n\n```python\nprint(1)\n1 + 1\n```\n1\n2\n\nraw text'
    )
  })

  it('leaves out JSON that is not a notebook, and files that are none of the formats', async () => {
    const outputs = await Promise.all(
      [
        strToU8(JSON.stringify({cells: [], nbformat: '4'})),
        strToU8(JSON.stringify({cells: 'none', nbformat: 4})),
        zipSync({'notes.txt': strToU8('hello')}),
        Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0),
        strToU8('plain text'),
        new Uint8Array(),
      ].map(async bytes => extract(bytes))
    )

    expect(outputs).toEqual(
      Array.from({length: 6}, () => ({type: 'unsupported'}))
    )
  })

  it('reads a PDF: its text, and the page images it calls for', async () => {
    const pdf = makePdf(
      [{lines: ['Text only']}, {images: [{x: 0, y: 0, ...PAGE}]}],
      await makeJpeg()
    )

    const output = await readText(pdf)

    expect(output.format).toBe('pdf')
    expect(output.text).toBe('--- Page 1 ---\nText only\n\n--- Page 2 ---')
    expect(output.pageImages.map(({page}) => page)).toEqual([2])
    expect(output.imagesStopped).toBe(false)
  })

  it('fails a file that starts like a PDF but is not one', async () => {
    const output = await extract(strToU8('%PDF-1.7\nnothing else'))

    expect(output.type).toBe('failed')
  })
})

describe('extract, given a zip past the caps', () => {
  it('refuses an entry that declares a huge size, before inflating it', async () => {
    const zip = patch(bareDocx(strToU8('<w:document/>')), DOCUMENT, {
      size: 1024 * MIB,
    })

    expect(await failure(zip)).toMatch(/expands/)
  })

  it('refuses entries that together declare more than 32 MiB', async () => {
    const zip = zipSync({
      [DOCUMENT]: [new Uint8Array(17 * MIB), {level: 0}],
      'word/media/big.bin': [new Uint8Array(16 * MIB), {level: 0}],
    })

    expect(await failure(zip)).toMatch(/size limit/)
  })

  it('stops inflating an entry that expands past the size it declares', async () => {
    const zip = bareDocx(new Uint8Array(30 * MIB))

    patch(zip, DOCUMENT, {size: compressedSize(zip, DOCUMENT) * 100})

    expect(await failure(zip)).toMatch(/past the size it declares/)
  })

  it('refuses an entry that expands more than 200×', async () => {
    const zip = bareDocx(new Uint8Array(4 * MIB))

    expect(await failure(zip)).toMatch(/200×/)
  })

  it('refuses more than 2,048 entries', async () => {
    const entries = Object.fromEntries(
      Array.from({length: 2049}, (_, index) => [`f${index}.txt`, strToU8('x')])
    )

    expect(await failure(zipSync(entries))).toMatch(/2048 entries/)
    expect(
      await extract(
        zipSync(Object.fromEntries(Object.entries(entries).slice(1)))
      )
    ).toEqual({type: 'unsupported'})
  })

  it('refuses encryption and compression methods other than stored and deflate', async () => {
    const body = strToU8('<w:document/>')

    expect(await failure(patch(bareDocx(body), DOCUMENT, {flags: 1}))).toMatch(
      /encrypted/
    )
    expect(
      await failure(patch(bareDocx(body), DOCUMENT, {method: 12}))
    ).toMatch(/method 12/)
  })
})
