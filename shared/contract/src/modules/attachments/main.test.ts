import type {Attachment} from './main'

import {describe, expect, it} from 'vitest'

import {inlineForm, inlineImagesSize, planInline} from './main'

const MIB = 1024 * 1024

type Sized = Pick<Attachment, 'mediaType' | 'size' | 'shrunkSize'>

function file(mediaType: Attachment['mediaType'], size: number): Sized {
  return {mediaType, size, shrunkSize: null}
}

describe('inlineForm', () => {
  it('sends an image inline on both Providers', () => {
    expect(inlineForm('claude', file('image/png', MIB))).toBe('image')
    expect(inlineForm('chatgpt', file('image/webp', MIB))).toBe('image')
  })

  it('sends an image over 10 MiB inline only as its shrunk copy', () => {
    const large = file('image/jpeg', 10 * MIB + 1)

    expect(inlineForm('claude', large)).toBeNull()
    expect(inlineForm('chatgpt', {...large, shrunkSize: MIB})).toBe('image')
  })

  it('sends a PDF inline on Claude alone', () => {
    expect(inlineForm('claude', file('application/pdf', MIB))).toBe('pdf')
    expect(inlineForm('chatgpt', file('application/pdf', MIB))).toBeNull()
  })

  it('sends a PDF that alone passes Claude’s budget by path only', () => {
    expect(inlineForm('claude', file('application/pdf', 15 * MIB))).toBe('pdf')
    expect(
      inlineForm('claude', file('application/pdf', 15 * MIB + 1))
    ).toBeNull()
  })

  it('sends a text file inline up to 32 KB on both Providers', () => {
    const under = file('text/plain', 32 * 1024)
    const over = file('text/plain', 32 * 1024 + 1)

    expect(inlineForm('claude', under)).toBe('text')
    expect(inlineForm('chatgpt', under)).toBe('text')
    expect(inlineForm('claude', over)).toBeNull()
    expect(inlineForm('chatgpt', over)).toBeNull()
  })

  it('sends any other file and a folder by path only', () => {
    expect(
      inlineForm('claude', file('application/octet-stream', 10))
    ).toBeNull()
    expect(inlineForm('chatgpt', file('inode/directory', 0))).toBeNull()
  })
})

describe('inlineImagesSize', () => {
  it('counts each image as it goes inline, and nothing else', () => {
    expect(
      inlineImagesSize([
        file('image/png', 3 * MIB),
        {...file('image/png', 40 * MIB), shrunkSize: 2 * MIB},
        file('image/png', 11 * MIB),
        file('application/pdf', 5 * MIB),
      ])
    ).toBe(5 * MIB)
  })
})

describe('planInline', () => {
  it('gives ChatGPT no budget: every image stays inline', () => {
    const images = Array.from({length: 95}, () => file('image/png', MIB))
    const plan = planInline('chatgpt', [images])

    expect(plan.budget).toBeNull()
    expect(plan.forms[0]).toEqual(images.map(() => 'image'))
  })

  it('sends Claude’s oldest by path only once a Thread passes 20 MiB of base64', () => {
    // 6 MiB is 8 MiB of base64: two fit in 20 MiB, a third doesn't.
    const pdf = file('application/pdf', 6 * MIB)
    const plan = planInline('claude', [[pdf], [pdf, pdf]])

    expect(plan.forms).toEqual([[null], ['pdf', 'pdf']])

    expect(plan.budget).toEqual({
      base64Bytes: 16 * MIB,
      files: 2,
      pathOnly: 1,
    })
  })

  it('sends everything older than the first that doesn’t fit by path only', () => {
    const small = file('image/png', 3)
    const large = file('application/pdf', 12 * MIB)
    const plan = planInline('claude', [[small], [large], [large]])

    expect(plan.forms).toEqual([[null], [null], ['pdf']])
    expect(plan.budget?.pathOnly).toBe(2)
  })

  it('sends Claude’s oldest by path only once a Thread passes 90 files', () => {
    const image = file('image/png', 3)
    const text = file('text/plain', 3)

    const plan = planInline('claude', [
      [image, text, image],
      Array.from({length: 89}, () => image),
    ])

    expect(plan.forms[0]).toEqual([null, 'text', 'image'])
    expect(plan.forms[1]?.every(form => form === 'image')).toBe(true)
    expect(plan.budget).toEqual({base64Bytes: 360, files: 90, pathOnly: 1})
  })

  it('counts an image against the budget as its shrunk copy', () => {
    const plan = planInline('claude', [
      [{...file('image/png', 40 * MIB), shrunkSize: 3 * MIB}],
    ])

    expect(plan.budget?.base64Bytes).toBe(4 * MIB)
  })
})
