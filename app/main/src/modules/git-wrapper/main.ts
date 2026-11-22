import fs from 'node:fs'
import path from 'node:path'

export function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Shell lines that run `$program`, one of the programs of the build
 * `gitProgram` is in, and name it `$tool` when it isn't there yet. The build
 * is made for `/`, so it is told where its own folders are (ADR 0024), for the
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
 * On Linux, `folder` is last on the `PATH` of `claude` and Codex, so its
 * script is the `git` the AI runs where the machine has no other (ADR 0026).
 * `gitProgram` is where the app's own `git` is or will be: the script looks
 * for it on every call.
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
