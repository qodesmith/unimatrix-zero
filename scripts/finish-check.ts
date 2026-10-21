/** Ends a check script: the problems under `heading` and exit 1, or `passed`. */
export function finishCheck(
  problems: string[],
  heading: string,
  passed: string
) {
  if (problems.length > 0) {
    console.error(`${heading}\n${problems.join('\n')}`)
    process.exit(1)
  }

  console.log(passed)
}
