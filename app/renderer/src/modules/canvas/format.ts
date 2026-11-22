export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`

  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`

  return String(tokens)
}
