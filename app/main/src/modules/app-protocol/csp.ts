type CspOptions = {
  scriptNonce?: string
  connectSources?: string[]
}

export function renderCsp({
  scriptNonce,
  connectSources = [],
}: CspOptions = {}): string {
  const script = ["'self'", "'wasm-unsafe-eval'"]
  if (scriptNonce) script.push(`'nonce-${scriptNonce}'`)
  return [
    "default-src 'none'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: uzfile:",
    'media-src uzfile: blob:',
    "font-src 'self' data:",
    `connect-src ${["'self'", ...connectSources].join(' ')}`,
    'frame-src uzfile:',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
