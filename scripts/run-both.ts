/**
 * Starts both tasks at once and waits for both to settle, so neither is left
 * running when the other throws. Throws an `AggregateError` when both throw.
 */
export async function runBoth<First, Second>(
  first: () => Promise<First>,
  second: () => Promise<Second>
): Promise<[First, Second]> {
  const [one, two] = await Promise.allSettled([first(), second()])

  if (one.status === 'rejected' && two.status === 'rejected') {
    throw new AggregateError([one.reason, two.reason], 'both tasks threw')
  }

  if (one.status === 'rejected') throw one.reason

  if (two.status === 'rejected') throw two.reason

  return [one.value, two.value]
}
