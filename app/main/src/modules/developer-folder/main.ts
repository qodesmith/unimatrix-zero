import fs from 'node:fs'
import path from 'node:path'

function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

const NOT_INSTALLED = `echo "$tool: not installed on this Mac" >&2
    exit 127`

/**
 * The build is made for `/`, so each call names its sub-programs, its
 * templates and its own system config (ADR 0024). They are set for the one
 * call, so none of the three reaches anything else the AI runs.
 */
function gitCases(gitProgram: string) {
  const root = path.join(path.dirname(gitProgram), '..')

  return `  git)
    program=${quoted(gitProgram)}
    ;;
  git-upload-pack | git-receive-pack | git-upload-archive | git-shell)
    program=${quoted(path.join(root, 'libexec', 'git-core'))}/$tool
    ;;
  *)
    ${NOT_INSTALLED}
    ;;
esac

if [ ! -x "$program" ]; then
  echo "$tool: not ready yet: Unimatrix Zero is still downloading it. Try again in a minute." >&2
  exit 127
fi

GIT_EXEC_PATH=${quoted(path.join(root, 'libexec', 'git-core'))} \\
GIT_TEMPLATE_DIR=${quoted(path.join(root, 'share', 'git-core', 'templates'))} \\
GIT_CONFIG_SYSTEM=${quoted(path.join(root, 'etc', 'gitconfig'))} \\
exec "$program" "$@"`
}

/**
 * Apple's stubs in `/usr/bin` run this as `xcrun <tool> <args...>` when
 * `DEVELOPER_DIR` names the folder it is in. The script looks for `git` on
 * every call, so one written while the build downloads runs it once it lands.
 */
function xcrunScript(gitProgram: string | null) {
  const cases = gitProgram
    ? gitCases(gitProgram)
    : `  *)
    ${NOT_INSTALLED}
    ;;
esac`

  return `#!/bin/sh
# Written by Unimatrix Zero at every launch. Changes made here are lost.
tool=$1
[ $# -gt 0 ] && shift

case $tool in
${cases}
`
}

/**
 * The developer folder the app gives a Mac that has none: one script,
 * `usr/bin/xcrun`, that answers every stub in `/usr/bin` so none opens the
 * "install developer tools" dialog (ADR 0025). `gitProgram` is where the
 * app's own `git` is or will be; null when the manifest has none.
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
