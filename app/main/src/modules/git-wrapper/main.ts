import {NO_LOGIN_HELPER} from '@uz/vendor-program/git-login'
import fs from 'node:fs'
import path from 'node:path'

export function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * Needs `$program` and `$tool` set. The build is made for `/`, so it gets its
 * own folders for this call only, never in what else the AI runs (ADR 0024).
 * So do the settings that keep it from asking for a login (ADR 0027): an empty
 * `GIT_ASKPASS` also stops git falling back to `core.askPass` and
 * `SSH_ASKPASS`, which `GIT_TERMINAL_PROMPT=0` does not.
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

helper=${quoted(NO_LOGIN_HELPER)}
n=\${GIT_CONFIG_COUNT:-0}
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= GIT_CONFIG_COUNT=$((n + 1)) \\
  "GIT_CONFIG_KEY_$n=credential.helper" "GIT_CONFIG_VALUE_$n=$helper"

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

/** The `git` the AI runs on a Linux machine with no other (ADR 0026). */
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
