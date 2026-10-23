/** A token count as the badge shows it: 950, 12.3k, 1.2M. */
export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`

  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`

  return String(tokens)
}
