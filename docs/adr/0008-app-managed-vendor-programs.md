# App-managed vendor programs with isolated config

The app never uses the user's installed `claude` or `codex`. It downloads the exact, unmodified vendor builds named in the signed manifest ([ADR 0007](./0007-thin-shell-signed-app-bundles.md)) into `userData`, checks their hashes, and runs them with their own `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. The Claude Agent SDK is pinned to one `claude` build and our Codex client types to one Codex version, so a user's copy at whatever version would silently lose features or break; most of our users don't have the CLIs anyway, and sharing `~/.claude` / `~/.codex` risks the two copies invalidating each other's tokens, migrating each other's files, and leaking personal settings and `CLAUDE.md` into Trees. Findings: [Ship the vendor programs or use the user's installed copies](https://github.com/qodesmith/unimatrix-zero/issues/20).

## Considered Options

- **Built into the installer.** Rejected: about 250 MB (Claude) plus about 330 MB (Codex) per platform, doubled in the universal Mac build; versions could only change with a shell release; electron-builder's ad-hoc re-signing would break the vendors' signatures and make Claude's Keychain entry prompt after updates.
- **The user's installed copies** (T3 Code's approach). Rejected: unknown versions that update on their own schedule, a background install onto the user's PATH for most users, and shared config.

## Consequences

- **Downloaded on Connect**, per Provider, so a ChatGPT-only user never downloads Claude.
- **Versions move only with app bundles.** Each bundle names its `claude`/`codex` versions and hashes in the manifest; updated programs download with the bundle before "Restart to update", and the previous version is deleted once the new bundle is good. A weekly CI job bumps the SDK and Codex, regenerates the types and runs smoke tests, because OpenAI gates new models on a minimum Codex version ("requires a newer version of Codex"). Gated models show disabled in the picker as "Needs an app update".
- **Vendor signatures stay intact.** Programs are never re-signed, so they keep Anthropic's and OpenAI's notarized Developer ID signatures, and downloads made by the app carry no quarantine flag.
- **Self-updaters are off:** `DISABLE_UPDATES=1` for Claude, `check_for_update_on_startup = false` for Codex.
- **Users who already use the CLIs sign in again in the app.** The subscription and its usage limits remain shared; nothing is written to `~/.claude` or `~/.codex`. Claude runs with `settingSources: []` and auto memory off. Administrator policy and project files in a linked folder are still read.
- **No setting for a custom binary path**, only a developer-only environment variable.
