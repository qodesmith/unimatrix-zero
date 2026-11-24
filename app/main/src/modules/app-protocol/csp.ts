/** The extraction window's page: its own bundle, its worker and wasm, no more. */
export const EXTRACTOR_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

interface CspOptions {
  scriptNonce?: string
  connectSources?: string[]
}

export function renderCsp({
  scriptNonce,
  connectSources = [],
}: CspOptions = {}): string {
  const script = ["'self'"]

  if (scriptNonce) script.push(`'nonce-${scriptNonce}'`)

  return [
    "default-src 'none'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: uzfile:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...connectSources].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
