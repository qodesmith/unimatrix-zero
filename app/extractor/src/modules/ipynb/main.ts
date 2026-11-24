import {tidyLines} from '#modules/xml/main'
import {z} from 'zod'

const OPENING_BRACE = 0x7b

/** Notebook text: one string, or lines to join. */
const MultilineSchema = z.union([z.string(), z.array(z.string())])

const OutputSchema = z.looseObject({
  output_type: z.string(),
  text: MultilineSchema.optional(),
  data: z.looseObject({'text/plain': MultilineSchema.optional()}).optional(),
})

const CellSchema = z.looseObject({
  cell_type: z.string(),
  source: MultilineSchema,
  /**
   * An output that is not text, or is malformed, is left out rather than
   * failing the notebook.
   */
  outputs: z.array(OutputSchema.nullable().catch(null)).optional(),
})

const NotebookSchema = z.looseObject({
  nbformat: z.number(),
  cells: z.array(CellSchema),
  metadata: z
    .looseObject({
      language_info: z.looseObject({name: z.string().optional()}).optional(),
      kernelspec: z.looseObject({language: z.string().optional()}).optional(),
    })
    .optional(),
})

type Notebook = z.infer<typeof NotebookSchema>

function joined(text: z.infer<typeof MultilineSchema> | undefined) {
  return (Array.isArray(text) ? text.join('') : (text ?? '')).replace(/\n$/, '')
}

/** The bytes as a notebook, or null when they are not one. */
export function parseNotebook(bytes: Uint8Array) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf

  const first = bytes.findIndex(
    (byte, index) => (!bom || index > 2) && byte > 0x20
  )

  if (bytes[first] !== OPENING_BRACE) return null

  try {
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    )

    const notebook = NotebookSchema.safeParse(json)

    return notebook.success ? notebook.data : null
  } catch {
    return null
  }
}

function outputText(output: z.infer<typeof OutputSchema> | null) {
  if (output?.output_type === 'stream') return [joined(output.text)]
  const plain = output?.data?.['text/plain']

  return plain === undefined ? [] : [joined(plain)]
}

export function readNotebook(notebook: Notebook) {
  const language =
    notebook.metadata?.language_info?.name ??
    notebook.metadata?.kernelspec?.language ??
    ''

  const cells = notebook.cells.map(cell => {
    const source = joined(cell.source)

    if (cell.cell_type !== 'code') return source

    return [
      `\`\`\`${language}\n${source}\n\`\`\``,
      ...(cell.outputs ?? []).flatMap(outputText),
    ].join('\n')
  })

  return tidyLines([cells.join('\n\n')])
}
