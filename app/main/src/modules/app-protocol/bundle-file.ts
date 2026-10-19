import path from 'node:path'

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

export type BundleFile = {filePath: string; mimeType: string}

/**
 * Maps a request path onto a file inside the bundle folder, or nothing. The SPA
 * fallback applies only to extensionless paths, so a missing asset is a 404.
 */
export function resolveBundleFile(
  bundleDir: string,
  pathname: string
): BundleFile | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return null

  const relative = decoded.replace(/^\/+/, '')
  const ext = path.posix.extname(relative)
  const target = ext === '' ? 'index.html' : relative
  const filePath = path.resolve(bundleDir, target)
  const root = path.resolve(bundleDir)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null

  const mimeType = mimeTypes[path.extname(filePath)]
  return mimeType ? {filePath, mimeType} : null
}
