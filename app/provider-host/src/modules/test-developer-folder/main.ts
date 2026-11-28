import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function markedDeveloperFolder(marker: string) {
  const developerDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'uz-live-developer-')
  )

  const bin = path.join(developerDir, 'usr', 'bin')
  fs.mkdirSync(bin, {recursive: true})

  fs.writeFileSync(
    path.join(bin, 'xcrun'),
    `#!/bin/sh\necho "${marker} $*"\n`,
    {mode: 0o755}
  )

  return developerDir
}
