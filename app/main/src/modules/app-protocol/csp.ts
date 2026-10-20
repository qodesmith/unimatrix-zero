type CspOptions = {
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
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...connectSources].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
