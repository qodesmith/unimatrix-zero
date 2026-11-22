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
 * One script answers every stub in `/usr/bin`, so none opens the "install
 * developer tools" dialog (ADR 0025). `gitProgram` is where the app's own
 * `git` is or will be: the script looks for it on every call.
 */
export function writeDeveloperFolder(
  folder: string,
  gitProgram: string | null
) {
  writeScript(path.join(folder, 'usr', 'bin', 'xcrun'), xcrunScript(gitProgram))
}
