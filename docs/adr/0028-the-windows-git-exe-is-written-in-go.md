# The Windows `git.exe` is written in Go

On Windows the app's own `git` is reached through a small `git.exe` last on `PATH` ([ADR 0026](./0026-the-apps-git-last-on-path-on-windows-and-linux.md)): it says "not ready yet" until the build is in place, and otherwise runs the build's `git` with the no-login settings for that call alone ([ADR 0027](./0027-the-apps-git-never-asks-for-a-login.md)). It has to be a real `.exe`, since a `.cmd`, `.bat` or `.ps1` each failed on a Windows 11 test machine. It is the repo's first native program, so it needs a toolchain. We chose Go: it builds a Windows `.exe` for x64 and arm64 from a Mac with nothing else installed, its standard library already passes a raw command line through unchanged, and the test version on that machine was about 80 lines. Findings: [#285](https://github.com/qodesmith/unimatrix-zero/issues/285).

## Considered Options

- **C**, as Git for Windows' own wrapper is written. Rejected: building for Windows from a Mac needs a MinGW or `zig cc` cross toolchain, and the process, handle and Ctrl+C code that Go's standard library gives is ours to write and get right.
- **Rust.** Rejected: it needs a Windows linker and target libraries for each CPU, and a toolchain much larger than Go's for a hundred lines.
- **Git for Windows' own `git.exe`, configured.** Rejected: its configured mode adds arguments, not environment variables, and `GIT_TERMINAL_PROMPT` has no argument form.
- **A program compiled from TypeScript by Bun or Node.** Rejected: each carries a whole runtime, near 100 MB a CPU, to start one process.

## Consequences

- **One Go version, pinned in the module file**, and the build refuses any other and fetches none. The build flags leave out paths, the commit and the build id, so the same source gives the same bytes.
- **Built for `win32-x64` and `win32-arm64`, on the maintainer's Mac with the rest of a release** ([ADR 0016](./0016-releases-built-and-signed-on-the-maintainers-machine.md)). Native code lives in the shell ([ADR 0007](./0007-thin-shell-signed-app-bundles.md)), so the shell ships both, and at launch the app copies the one for its CPU into `userData`, only when it changed.
- **The program holds no words or settings of its own** beyond two lines for when it can't read its settings or start `git`. The app writes the build's path, the "not ready yet" line and the no-login settings into a file beside it at every launch, so they keep one wording with the Mac and Linux scripts.
- **Unsigned, like the app** ([ADR 0006](./0006-unsigned-distribution.md)). Smart App Control already stops the app, so it adds nothing there. Whether antivirus flags a small unsigned program that starts others is untested.
- **About 3 MB for each CPU**, and one more process, about 14 ms, for each `git` the AI runs.
- **CI builds it with the pinned Go**, runs its Go tests, and runs it in the "Windows with no git" job. Developers need Go only to build or test it.
