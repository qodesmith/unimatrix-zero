import fs from 'node:fs'
import path from 'node:path'

function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

const NOT_INSTALLED = `  *)
    echo "$tool: not installed on this Mac" >&2
    exit 127
    ;;
esac`

/**
 * The build is made for `/`, so it is told where its own folders are (ADR
 * 0024), for the one call: none of the three reaches what else the AI runs.
 */
function runningGit(gitProgram: string) {
  const root = path.join(path.dirname(gitProgram), '..')
  const subPrograms = quoted(path.join(root, 'libexec', 'git-core'))

  return `  git)
    program=${quoted(gitProgram)}
    ;;
  git-upload-pack | git-receive-pack | git-upload-archive | git-shell)
    program=${subPrograms}/$tool
    ;;
${NOT_INSTALLED}

if [ ! -x "$program" ]; then
  echo "$tool: not ready yet: Unimatrix Zero is still downloading it. Try again in a minute." >&2
  exit 127
fi

GIT_EXEC_PATH=${subPrograms} \\
GIT_TEMPLATE_DIR=${quoted(path.join(root, 'share', 'git-core', 'templates'))} \\
GIT_CONFIG_SYSTEM=${quoted(path.join(root, 'etc', 'gitconfig'))} \\
exec "$program" "$@"`
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
  const bin = path.join(folder, 'usr', 'bin')
  const script = path.join(bin, 'xcrun')
  const writing = `${script}.writing`

  fs.mkdirSync(bin, {recursive: true})
  fs.writeFileSync(writing, xcrunScript(gitProgram), {mode: 0o755})
  // Renamed over the old one, so a stub running now reads a whole script.
  fs.renameSync(writing, script)
}
