import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PATH_PROBE = 'uz-path-probe'

export function markedPathFolder(marker: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-path-'))

  fs.writeFileSync(
    path.join(folder, PATH_PROBE),
    `#!/bin/sh\necho "${marker} \${PATH##*:}"\n`,
    {mode: 0o755}
  )

  return folder
}
