/**
 * Copies `stream` to `write` a whole line at a time, so a line another task
 * writes to the same terminal never lands inside one.
 */
export async function forwardLines(
  stream: ReadableStream<Uint8Array>,
  write: (text: string) => void
) {
  let unfinished = ''

  for await (const text of stream.pipeThrough(new TextDecoderStream())) {
    const pending = unfinished + text
    const end = pending.lastIndexOf('\n') + 1

    if (end > 0) write(pending.slice(0, end))
    unfinished = pending.slice(end)
  }

  if (unfinished) write(`${unfinished}\n`)
}
