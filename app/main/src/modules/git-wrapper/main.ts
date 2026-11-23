import {NO_LOGIN_HELPER} from '@uz/vendor-program/git-login'
import fs from 'node:fs'
import path from 'node:path'

export function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

export const NOT_READY =
  'not ready yet: Unimatrix Zero is still downloading it. Try again in a minute.'

const NO_LIBCURL =
  "git: can't use https:// addresses on this computer, which lacks the libcurl.so.4 library."

/**
 * Needs `$program` and `$tool` set. Its folders and no-login settings stay in
 * this call, never in what else the AI runs (ADR 0024, ADR 0027). An empty
 * `GIT_ASKPASS` blocks `core.askPass` and `SSH_ASKPASS` for `git`'s own
 * prompts; `GIT_TERMINAL_PROMPT=0` does not. `ssh` reads neither, so
 * `SSH_ASKPASS_REQUIRE=never` keeps its window shut.
 */
export function runningBuild(gitProgram: string) {
  const root = path.join(path.dirname(gitProgram), '..')
  const subPrograms = quoted(path.join(root, 'libexec', 'git-core'))

  const settings = `if [ ! -x "$program" ]; then
  echo "$tool: ${NOT_READY}" >&2
  exit 127
fi

helper=${quoted(NO_LOGIN_HELPER)}
n=\${GIT_CONFIG_COUNT:-0}
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= SSH_ASKPASS_REQUIRE=never \\
  GIT_CONFIG_COUNT=$((n + 1)) \\
  "GIT_CONFIG_KEY_$n=credential.helper" "GIT_CONFIG_VALUE_$n=$helper"

GIT_EXEC_PATH=${subPrograms} \\
GIT_TEMPLATE_DIR=${quoted(path.join(root, 'share', 'git-core', 'templates'))} \\
GIT_CONFIG_SYSTEM=${quoted(path.join(root, 'etc', 'gitconfig'))} \\`

  return {
    subPrograms,
    lines: `${settings}
exec "$program" "$@"`,
    /**
     * Only `git-remote-http` needs `libcurl.so.4`, so the rest of `git` runs
     * without it (ADR 0026).
     */
    linesTellingNoLibcurl: `${settings}
"$program" "$@"
code=$?

if [ $code -ne 0 ] && ldd ${subPrograms}/git-remote-http 2>/dev/null | grep -q 'libcurl\\.so\\.4 => not found'; then
  echo ${quoted(NO_LIBCURL)} >&2
fi

exit $code`,
  }
}

export function writeScript(file: string, script: string) {
  const writing = `${file}.writing`

  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(writing, script, {mode: 0o755})
  // Renamed over the old one, so a call running now reads a whole script.
  fs.renameSync(writing, file)
}

/** Linux's: a Mac runs the developer folder's script instead (ADR 0025). */
export function writeGitWrapper(folder: string, gitProgram: string) {
  writeScript(
    path.join(folder, 'git'),
    `#!/bin/sh
# Written by Unimatrix Zero at every launch. Changes made here are lost.
tool=git
program=${quoted(gitProgram)}

${runningBuild(gitProgram).linesTellingNoLibcurl}
`
  )
}
