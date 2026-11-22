import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PATH_PROBE = 'uz-path-probe'

/**
 * A folder whose one program, `PATH_PROBE`, prints `marker` and the last
 * folder on the `PATH` it was run with.
 */
export function markedPathFolder(marker: string) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-path-'))

  fs.writeFileSync(
    path.join(folder, PATH_PROBE),
    `#!/bin/sh\necho "${marker} \${PATH##*:}"\n`,
    {mode: 0o755}
  )

  return folder
}
