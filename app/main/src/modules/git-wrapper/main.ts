import fs from 'node:fs'
import path from 'node:path'

export function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Shell lines for a script that has set `$program` and `$tool`. The build is
 * made for `/`, so it is told where its own folders are (ADR 0024), for the
 * one call: none of the three reaches what else the AI runs.
 */
export function runningBuild(gitProgram: string) {
  const root = path.join(path.dirname(gitProgram), '..')
  const subPrograms = quoted(path.join(root, 'libexec', 'git-core'))

  return {
    subPrograms,
    lines: `if [ ! -x "$program" ]; then
  echo "$tool: not ready yet: Unimatrix Zero is still downloading it. Try again in a minute." >&2
  exit 127
fi

GIT_EXEC_PATH=${subPrograms} \\
GIT_TEMPLATE_DIR=${quoted(path.join(root, 'share', 'git-core', 'templates'))} \\
GIT_CONFIG_SYSTEM=${quoted(path.join(root, 'etc', 'gitconfig'))} \\
exec "$program" "$@"`,
  }
}

export function writeScript(file: string, script: string) {
  const writing = `${file}.writing`

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(writing, script, {mode: 0o755})
  // Renamed over the old one, so a call running now reads a whole script.
  fs.renameSync(writing, file)
}

/**
 * The `git` the AI runs on a Linux machine with no other (ADR 0026).
 * `gitProgram` is where the app's own is or will be: looked for on every call.
 */
export function writeGitWrapper(folder: string, gitProgram: string) {
  writeScript(
    path.join(folder, 'git'),
    `#!/bin/sh
# Written by Unimatrix Zero at every launch. Changes made here are lost.
tool=git
program=${quoted(gitProgram)}

${runningBuild(gitProgram).lines}
`
  )
}
