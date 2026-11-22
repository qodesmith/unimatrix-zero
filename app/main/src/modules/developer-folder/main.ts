import {quoted, runningBuild, writeScript} from '#modules/git-wrapper/main'
import path from 'node:path'

const NOT_INSTALLED = `  *)
    echo "$tool: not installed on this Mac" >&2
    exit 127
    ;;
esac`

function runningGit(gitProgram: string) {
  const {subPrograms, lines} = runningBuild(gitProgram)

  return `  git)
    program=${quoted(gitProgram)}
    ;;
  git-upload-pack | git-receive-pack | git-upload-archive | git-shell)
    program=${subPrograms}/$tool
    ;;
${NOT_INSTALLED}

${lines}`
}

/** A stub in `/usr/bin` runs this as `xcrun <tool> <args...>`. */
function xcrunScript(gitProgram: string | null) {
  return `#!/bin/sh
# Written by Unimatrix Zero at every launch. Changes made here are lost.
tool=$1
[ $# -gt 0 ] && shift

case $tool in
${gitProgram ? runningGit(gitProgram) : NOT_INSTALLED}
`
}

/**
 * Answers every stub in `/usr/bin`, so none opens the install dialog (ADR
 * 0025). `gitProgram` may not exist yet: the script looks on every call.
 */
export function writeDeveloperFolder(
  folder: string,
  gitProgram: string | null
) {
  writeScript(path.join(folder, 'usr', 'bin', 'xcrun'), xcrunScript(gitProgram))
}
