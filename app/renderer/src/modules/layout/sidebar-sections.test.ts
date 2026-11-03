import {DEFAULT_SIDEBAR_SECTIONS} from '@uz/contract/layout'
import {expect, it} from 'vitest'

import {arrange, resetSplit, resized} from './sidebar-sections'

const open = {
  trees: {size: 50, collapsed: false},
  files: {size: 30, collapsed: false},
  usage: {size: 20, collapsed: false},
}

const filesShut = {...open, files: {size: 30, collapsed: true}}

it('shrinks a collapsed section to its header, the open ones sharing the rest as their sizes do', () => {
  expect(arrange(filesShut, 2)).toEqual({trees: 70, files: 2, usage: 28})
})

it('leaves the space below the headers to the last section when all are collapsed', () => {
  const shut = {
    trees: {size: 50, collapsed: true},
    files: {size: 30, collapsed: true},
    usage: {size: 20, collapsed: true},
  }

  expect(arrange(shut, 4)).toEqual({trees: 4, files: 4, usage: 92})
})

it('keeps a collapsed section’s size, for expanding to, when the open ones are dragged', () => {
  expect(resized(filesShut, {trees: 48, files: 4, usage: 48}, 4)).toEqual({
    trees: {size: 35, collapsed: false},
    files: {size: 30, collapsed: true},
    usage: {size: 35, collapsed: false},
  })
})

it('arranges a drag’s sizes back to the layout dragged to', () => {
  const back = arrange(
    resized(filesShut, {trees: 61, files: 4, usage: 35}, 4),
    4
  )

  expect(back.trees).toBeCloseTo(61)
  expect(back.files).toBeCloseTo(4)
  expect(back.usage).toBeCloseTo(35)
})

it('resets two sections to the default split of their space, leaving the third alone', () => {
  const usage = {size: 15, collapsed: true}

  const reset = resetSplit(
    {
      trees: {size: 20, collapsed: false},
      files: {size: 48, collapsed: false},
      usage,
    },
    'trees',
    'files'
  )

  expect(reset.trees.size + reset.files.size).toBeCloseTo(68)
  expect(reset.trees.size / reset.files.size).toBeCloseTo(
    DEFAULT_SIDEBAR_SECTIONS.trees.size / DEFAULT_SIDEBAR_SECTIONS.files.size
  )
  expect(reset.usage).toEqual(usage)
})
