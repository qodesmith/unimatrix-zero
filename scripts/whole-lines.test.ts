import {expect, it} from 'vitest'

import {forwardLines} from './whole-lines.ts'

function streamSplitAt(text: string, offsets: number[]) {
  const bytes = new TextEncoder().encode(text)
  const ends = [...offsets, bytes.length]

  return new ReadableStream<Uint8Array>({
    start(controller) {
      ends.forEach((end, index) => {
        controller.enqueue(bytes.slice(ends[index - 1] ?? 0, end))
      })
      controller.close()
    },
  })
}

it('writes only whole lines from chunks cut mid-character and mid-line, and ends an unfinished last line', async () => {
  const written: string[] = []

  // Cuts inside "✓", inside the first "…" and inside the second.
  const stream = streamSplitAt('✓ a…\n× b…\n2 passed', [1, 6, 14])

  await forwardLines(stream, text => written.push(text))

  expect(written).toEqual(['✓ a…\n', '× b…\n', '2 passed\n'])
})
