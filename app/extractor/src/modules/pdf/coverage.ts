import type {PDFOperatorList} from 'pdfjs-dist/types/src/display/api'

import {OPS} from 'pdfjs-dist'
import {z} from 'zod'

/** A PDF matrix `[a, b, c, d, e, f]`, as pdf.js passes it. */
const MatrixSchema = z.preprocess(
  value => (value instanceof Float32Array ? [...value] : value),
  z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ])
)

const GroupSchema = z.object({matrix: z.unknown()})

type Matrix = z.infer<typeof MatrixSchema>

interface GraphicsState {
  current: Matrix
  stack: Matrix[]
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/**
 * Each paints one image into the unit square of the current matrix.
 * `getOperatorList()` skips pdf.js's optimizer, so the merged operators
 * (`paintImageXObjectRepeat` and the groups) never appear in it.
 */
const IMAGES = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintSolidColorImageMask,
])

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a pdf.js operator's argument is untyped; MatrixSchema parses it
function matrixOf(value: unknown): Matrix {
  const matrix = MatrixSchema.safeParse(value)

  return matrix.success ? matrix.data : IDENTITY
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a pdf.js group's argument is untyped; GroupSchema parses it
function groupMatrix(value: unknown) {
  const group = GroupSchema.safeParse(value)

  return group.success ? matrixOf(group.data.matrix) : IDENTITY
}

/** `outer` applied after `inner`, as canvas's `transform()` does. */
function multiply(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer
  const [g, h, i, j, k, l] = inner

  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}

/** Follows the current matrix through one operator, as pdf.js's canvas does. */
function track(state: GraphicsState, op: number, args: unknown[]) {
  switch (op) {
    case OPS.save:
      state.stack.push(state.current)
      break
    case OPS.restore:
    case OPS.paintFormXObjectEnd:
    case OPS.endGroup:
      state.current = state.stack.pop() ?? state.current
      break
    case OPS.transform:
      state.current = multiply(state.current, matrixOf(args))
      break
    case OPS.paintFormXObjectBegin:
      state.stack.push(state.current)
      state.current = multiply(state.current, matrixOf(args[0]))
      break
    case OPS.beginGroup:
      state.stack.push(state.current)
      state.current = multiply(state.current, groupMatrix(args[0]))
      break
    default:
  }
}

/** The unit square under `matrix`: its bounding box's area, clipped to `view`. */
function areaOnPage(matrix: Matrix, view: number[]) {
  const [a, b, c, d, e, f] = matrix
  const xs = [e, a + e, c + e, a + c + e]
  const ys = [f, b + f, d + f, b + d + f]
  const [left = 0, bottom = 0, right = 0, top = 0] = view

  const width =
    Math.min(Math.max(...xs), right) - Math.max(Math.min(...xs), left)

  const height =
    Math.min(Math.max(...ys), top) - Math.max(Math.min(...ys), bottom)

  return width > 0 && height > 0 ? width * height : 0
}

/**
 * The share of the page its images cover: each image's bounding box on the
 * page, summed, over the page's area. Overlaps count twice.
 */
export function imageCoverage(operators: PDFOperatorList, view: number[]) {
  const [left = 0, bottom = 0, right = 0, top = 0] = view
  const pageArea = (right - left) * (top - bottom)
  const state: GraphicsState = {current: IDENTITY, stack: []}
  let covered = 0

  for (const [index, op] of operators.fnArray.entries()) {
    track(state, op, operators.argsArray[index] ?? [])

    if (IMAGES.has(op)) covered += areaOnPage(state.current, view)
  }

  return pageArea > 0 ? covered / pageArea : 0
}
