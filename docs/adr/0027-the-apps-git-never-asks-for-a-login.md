# The app's own `git` never asks for a login

A `git push`, or a `clone` or `fetch` of a private repo, over HTTPS needs a login, and the app's own `git` ([ADR 0024](./0024-app-runs-its-own-pinned-git.md)) has none to give. Someone who asks the AI to push is almost always a developer with a `git` of their own, which the AI runs first, with their logins ([ADR 0025](./0025-a-developer-folder-for-a-mac-with-no-developer-tools.md), [ADR 0026](./0026-the-apps-git-last-on-path-on-windows-and-linux.md)). So the app's `git` never asks for a login: a command that needs one, with none saved, fails at once and prints one line, telling the user to install `git`, log in with it and try again. Findings: [#279](https://github.com/qodesmith/unimatrix-zero/issues/279).

## Considered Options

- **A login the app owns**, a Settings button or a credential helper turned on. Rejected: it would need a place to keep the login on each platform, the Linux build has no Git Credential Manager, and the Sandbox keeps the AI's commands out of the keychains ([ADR 0018](./0018-commands-run-inside-the-vendor-sandbox.md)). All that for the rare user who wants to push and has no `git`.
- **Leaving each platform as the build has it.** Rejected: on a Mac and Linux the command fails with `could not read Username`, which says nothing useful, and on Windows under Codex the build's Git Credential Manager opens GitHub's login window with no warning.

## Consequences

- **One wording everywhere**, since on Windows the line can reach the user's own `git`.
- **Mac and Linux:** the scripts that run the app's `git` set, for the one call, `GIT_TERMINAL_PROMPT=0`, an empty `GIT_ASKPASS` so no password program of the user's desktop opens, and one helper that prints the line. They go after any `GIT_CONFIG_COUNT` already there. None reaches `claude`, Codex, the user's own `git` or anything else they run.
- **Windows:** there is no script, so the app adds `GCM_INTERACTIVE=never`, `GIT_TERMINAL_PROMPT=0` and the same helper to the environment it starts `claude` and Codex with, after any `GIT_CONFIG_COUNT` already there. The build's own helper, Git Credential Manager, runs first: a login already saved on the PC still works, and only asking for one is off. The app leaves the build and its `etc/gitconfig` as they are.
- **On Windows the settings reach the user's own `git`** when the AI runs it: no login window opens from the AI's command, and saved logins still work. `claude` already turns prompts off for every `git` it runs there, so Codex now matches it. One Provider dependency: that these variables reach the commands the AI runs (`windows-environment-reaches-commands`).
- **Only the non-developer's path is guarded** ([PRD §1](../prd/01-initial-release/01-product.md)). A credential helper the user set up runs as they set it, before the app's line, so a saved login still works. On Windows a password program of theirs (`GIT_ASKPASS`, `SSH_ASKPASS` or `core.askPass`) runs too. Mac and Linux keep the empty `GIT_ASKPASS`, since some Linux desktops set `SSH_ASKPASS` for every user.
- **SSH is untouched:** a repo set up over SSH uses the user's own keys.
- **GitHub's API**, for pull requests and issues, takes a different login and is out of scope.
