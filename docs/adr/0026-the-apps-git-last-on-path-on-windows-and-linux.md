# On Windows and Linux, the app's own `git` is last on the `PATH` of `claude` and Codex

A Tree's AI runs `git` in the Tree's folder, and `claude` and Codex find it on `PATH`. Windows ships no `git`, and Linux often has none: Ubuntu's desktop install leaves it out. There the AI's `git` fails with "not recognized" or "command not found", and most of our users won't know how to install one. The app already has a working `git` on disk on both ([ADR 0024](./0024-app-runs-its-own-pinned-git.md)). So the app puts the folder of its own `git` last on the `PATH` it gives `claude` and Codex: the user's own `git` is found first where they have one, and the app's only where nothing else is. Findings: [#278](https://github.com/qodesmith/unimatrix-zero/issues/278).

## Considered Options

- **The app's folder first on `PATH`.** Rejected: a developer would lose their own `git`, its version and its setup inside the app.
- **Adding the folder only where `git` is missing.** Rejected: the app would have to look for a `git` at every start, and a wrong answer either way costs the user. Last on `PATH`, the question never comes up.
- **The Windows build's own bash for `claude`'s `Bash` tool.** Rejected: `claude` refused the build's `sh.exe` with "No suitable shell found", and the app never modifies a build (ADR 0024).
- **The developer folder of [ADR 0025](./0025-a-developer-folder-for-a-mac-with-no-developer-tools.md).** It exists only on a Mac: `DEVELOPER_DIR` and the stubs are Apple's.

## Consequences

- **The folder is on `PATH` from the first session**, before the build has downloaded, so `git` starts to work mid-session with no restart.
- **Windows: the build's own `cmd` folder.** Windows `git` finds its own sub-programs, so the app sets nothing more. Until the build is in place the folder doesn't exist, and `git` fails with "not recognized", as before this decision.
- **Linux: a folder in `userData` holding one wrapper script named `git`**, which the app writes at launch. The build is made for `/`, so the script tells it where its sub-programs, its templates and its own system config are, for the one call, as ADR 0025's script does. None of the three reaches `claude`, Codex or anything else they run. Until the build is in place the script fails with a "not ready yet" error.
- **The app gives `claude` on Windows the `PowerShell` tool.** On a PC with no Git Bash, `claude` offers no `Bash`, so with the tools the app names it could run no command at all. Both Providers run commands through PowerShell there and keep the `PATH` they started with.
- **The app starts Codex on Linux with no login shell** (`allow_login_shell=false`). With one, Debian's `/etc/profile` sets `PATH` outright and drops the app's folder. Linux only: on a Mac the login shell is how Codex finds the user's own tools, and on Windows Codex uses none.
- **The Windows build's credential helper stays on.** Under Codex, a `git` that needs a login opens Git Credential Manager's sign-in window. Under `claude` no window opens, since `claude` turns prompts off for the commands it runs, and the command fails. No helper is on in the Linux build. Signing in to a host is [#279](https://github.com/qodesmith/unimatrix-zero/issues/279).
- **HTTPS on Linux needs the system's `libcurl.so.4`**, which the Ubuntu and Debian desktops install. Without it `clone`, `fetch` and `push` over HTTPS fail with a missing-library error, and the app does nothing about that.
- **A missing `user.name` is left to the AI**, as ADR 0025 decided.
- **A developer's machine can't test the case that matters**, so CI runs the wrapper in a container with no `git`, and the Windows build on a runner with Git for Windows taken off `PATH`.
- **Three Provider dependencies:** that `claude` keeps a folder added last to `PATH` (`claude-keeps-path`), that Codex with no login shell does too (`codex-no-login-shell`), and that both run commands through PowerShell on Windows and keep it there (`windows-powershell-keeps-path`).
