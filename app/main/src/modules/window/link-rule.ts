const openableProtocols = new Set(['http:', 'https:', 'mailto:'])

export function isOpenableExternally(url: string): boolean {
  try {
    return openableProtocols.has(new URL(url).protocol)
  } catch {
    return false
  }
}
