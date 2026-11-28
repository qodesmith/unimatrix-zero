import {NO_LOGIN_HELPER} from '@uz/vendor-program/git-login'
import fs from 'node:fs'
import path from 'node:path'

export function quoted(text: string) {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`
}

const NOT_READY =
  'not ready yet: Unimatrix Zero is still downloading it. Try again in a minute.'

const NO_LIBCURL =
  "git: if this needed an https:// address, it can't work on this computer, which lacks the libcurl.so.4 library."

/** Needs `$program` and `$tool` set. */
export function runningBuild(gitProgram: string) {
  const root = path.join(path.dirname(gitProgram), '..')
  const subPrograms = quoted(path.join(root, 'libexec', 'git-core'))

  // An empty `GIT_ASKPASS` blocks `core.askPass` too; `GIT_TERMINAL_PROMPT=0`
  // does not. The text ends on a `\`, so the next line must run `"$program"`.
  const beforeProgram = `if [ ! -x "$program" ]; then
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
    lines: `${beforeProgram}
exec "$program" "$@"`,
    linesTellingNoLibcurl: `${beforeProgram}
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

/** Folder names match what `scripts/build-git-exe.ts` writes. */
export function shippedGitExe(builds: string, arch: string) {
  return path.join(builds, `win32-${arch}`, 'git.exe')
}

function sameBytes(one: string, other: string) {
  try {
    return fs.readFileSync(one).equals(fs.readFileSync(other))
  } catch {
    return false
  }
}

export function writeWindowsGitWrapper(
  folder: string,
  gitProgram: string,
  shipped: string
) {
  const settings = {
    program: gitProgram,
    notReady: `git: ${NOT_READY}`,
    environment: {GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0'},
    config: [{key: 'credential.helper', value: NO_LOGIN_HELPER}],
  }

  writeScript(
    path.join(folder, 'git-wrapper.json'),
    `${JSON.stringify(settings, null, 2)}\n`
  )

  const exe = path.join(folder, 'git.exe')

  if (!fs.existsSync(shipped) || sameBytes(shipped, exe)) return

  const writing = `${exe}.writing`
  fs.copyFileSync(shipped, writing)

  try {
    fs.renameSync(writing, exe)
  } catch (error) {
    // A `git` left running from the last launch holds the old one.
    fs.rmSync(writing, {force: true})
    process.stderr.write(
      `The app's git.exe wasn't replaced: ${String(error)}\n`
    )
  }
}

/** Linux's: a Mac runs the developer folder's script instead. */
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
