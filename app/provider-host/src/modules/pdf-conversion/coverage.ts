import type {OPS as Ops, PDFPageProxy, PageViewport} from 'pdfjs-dist'

import {z} from 'zod'

/** Numbers from pdf.js come as arrays or as `Float32Array`s. */
const NumbersSchema = z.union([
  z.array(z.number()),
  z.instanceof(Float32Array).transform(array => [...array]),
])

const MatrixSchema = NumbersSchema.pipe(
  z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ])
)

type Matrix = z.infer<typeof MatrixSchema>

type OperatorList = Awaited<ReturnType<PDFPageProxy['getOperatorList']>>

function multiply(
  [a, b, c, d, e, f]: Matrix,
  [a2, b2, c2, d2, e2, f2]: Matrix
): Matrix {
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ]
}

type Scale = [number, number, number, number]

function translations(positions: number[], [a, b, c, d]: Scale) {
  const matrices: Matrix[] = []

  for (let at = 0; at + 1 < positions.length; at += 2)
    matrices.push([a, b, c, d, positions[at] ?? 0, positions[at + 1] ?? 0])

  return matrices
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const SingleSchema = z.unknown().transform(() => [IDENTITY])

const RepeatSchema = z
  .tuple([z.unknown(), z.number(), z.number(), NumbersSchema])
  .transform(([, scaleX, scaleY, positions]) =>
    translations(positions, [scaleX, 0, 0, scaleY])
  )

const MaskRepeatSchema = z
  .tuple([
    z.unknown(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    NumbersSchema,
  ])
  .transform(([, a, b, c, d, positions]) =>
    translations(positions, [a, b, c, d])
  )

const TransformedSchema = z
  .array(z.looseObject({transform: MatrixSchema}))
  .transform(images => images.map(image => image.transform))

/**
 * For each operator that paints images, its arguments parsed into the matrices
 * that map the unit square onto each image it paints, relative to the current
 * transform.
 */
function imagePainters(ops: typeof Ops) {
  return new Map<number, z.ZodType<Matrix[]>>([
    [ops.paintImageXObject, SingleSchema],
    [ops.paintInlineImageXObject, SingleSchema],
    [ops.paintImageMaskXObject, SingleSchema],
    [ops.paintSolidColorImageMask, SingleSchema],
    [ops.paintImageXObjectRepeat, RepeatSchema],
    [ops.paintImageMaskXObjectRepeat, MaskRepeatSchema],
    [
      ops.paintImageMaskXObjectGroup,
      z.tuple([TransformedSchema]).transform(([images]) => images),
    ],
    [
      ops.paintInlineImageXObjectGroup,
      z.tuple([z.unknown(), TransformedSchema]).transform(([, map]) => map),
    ],
  ])
}

const FormSchema = z.tuple([MatrixSchema.nullable()]).rest(z.unknown())

/** Where each image on the page lands, as a matrix on the unit square. */
function imageMatrices(
  ops: typeof Ops,
  {fnArray, argsArray}: OperatorList,
  start: Matrix
) {
  const painters = imagePainters(ops)
  const saved: Matrix[] = []
  const images: Matrix[] = []
  let current = start

  for (const [at, op] of fnArray.entries()) {
    const args: unknown = argsArray[at]
    const paint = painters.get(op)

    if (paint) {
      const painted = paint.safeParse(args)

      if (painted.success)
        for (const matrix of painted.data)
          images.push(multiply(current, matrix))
    } else if (op === ops.save) {
      saved.push(current)
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd) {
      current = saved.pop() ?? current
    } else if (op === ops.transform) {
      const matrix = MatrixSchema.safeParse(args)

      if (matrix.success) current = multiply(current, matrix.data)
    } else if (op === ops.paintFormXObjectBegin) {
      saved.push(current)

      const form = FormSchema.safeParse(args)

      if (form.success && form.data[0])
        current = multiply(current, form.data[0])
    }
  }

  return images
}

/**
 * The area of the unit square under `matrix`'s bounding box that lies on the
 * page.
 */
function visibleArea(
  [a, b, c, d, e, f]: Matrix,
  width: number,
  height: number
) {
  const xs = [e, a + e, c + e, a + c + e]
  const ys = [f, b + f, d + f, b + d + f]

  const visibleWidth =
    Math.min(Math.max(...xs), width) - Math.max(Math.min(...xs), 0)

  const visibleHeight =
    Math.min(Math.max(...ys), height) - Math.max(Math.min(...ys), 0)

  return Math.max(0, visibleWidth) * Math.max(0, visibleHeight)
}

/**
 * The share of the page, 0 to 1, that its images cover. Images that overlap
 * count twice, so a page of layered images can reach 1 early.
 */
export function imageCoverage(
  ops: typeof Ops,
  operators: OperatorList,
  viewport: PageViewport
) {
  const start = MatrixSchema.parse(viewport.transform)
  const {width, height} = viewport

  const area = imageMatrices(ops, operators, start).reduce(
    (sum, matrix) => sum + visibleArea(matrix, width, height),
    0
  )

  return Math.min(1, area / (width * height))
}
