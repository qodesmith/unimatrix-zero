# Can sign-in and CLI install be fully hidden?

Research for [#4](https://github.com/qodesmith/unimatrix-zero/issues/4), part of the [v1 spec map](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched on 2026-09-27 against Claude Code 2.1.283, Claude Agent SDK 0.3.283, Codex CLI 0.157.1 and T3 Code `de251fc2`.

Each claim is tagged with where it comes from:

- **[doc]**: vendor documentation.
- **[src]**: source code.
- **[ran]**: observed on macOS on this machine.
- **[unverified]**: could not be confirmed.

## Verdict

**Yes, sign-in can be hidden for both providers on all three OSes.** No terminal is needed. What the user sees is:

- a button in our UI;
- the vendor's own sign-in page in their default browser;
- for Claude, possibly a code to paste back into our UI (see below).

That page is Anthropic's or OpenAI's, not ours, and it has to be. Anthropic's terms require that "sign-in to a Claude account must complete through Anthropic's own flow" [doc: legal].

**Installation can go away entirely.** We don't have to hide an install, because we don't need one:

- **Claude:** the Claude Agent SDK npm package already ships the signed, unmodified native `claude` binary.
- **Codex:** the Codex CLI is Apache-2.0 and ships per-platform binaries we can bundle.

The official installers are therefore only a fallback, and the product needs no `curl | bash` step.

The two providers get there differently:

| | Claude | ChatGPT (Codex) |
|---|---|---|
| Install | Bundle it: `@anthropic-ai/claude-agent-sdk` ships the `claude` binary per platform | Bundle it: `@openai/codex` per-platform binary (Apache-2.0) |
| Sign in | Spawn `claude auth login` with pipes, no TTY. Show the URL it prints and let the browser finish; if the browser can't reach the local callback, take the pasted code in our UI and write it to stdin | `codex app-server` JSON-RPC `account/login/start` (`chatgpt`) returns `authUrl`. We open it and wait for `account/login/completed`. Device code (`chatgptDeviceCode`) is a fallback |
| Status, email, plan | `claude auth status --json` (exit code 0/1), or the SDK's `initializationResult().account` | `account/read` gives `{type, email, planType}`; `account/rateLimits/read` gives usage |
| Sign out | `claude auth logout` | `account/logout` |
| Switch account | A separate `CLAUDE_CONFIG_DIR` per account | A separate `CODEX_HOME` per account |

**Main caveat, which is policy and not technical:** Anthropic's wording on third-party apps is strict (see [Policy](#policy-the-part-that-could-invalidate-the-plan)). The model that is explicitly allowed is "an end user signing in to the unmodified Claude Code binary with their own Claude subscription". The hidden flow above stays inside that model:

- We run the unmodified binary.
- The binary does the OAuth itself.
- We never see or store the token.

**Fallback:** if a hidden login step fails, follow T3 Code: open an embedded terminal (node-pty) inside our window with the vendor command pre-typed. If bundling ever becomes unacceptable, run the official installer as a hidden child process first.

## Policy (the part that could invalidate the plan)

**Anthropic** ([Legal and compliance → Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance)) [doc]:

- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- The same page carves out: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code…"
- "Can customers offer Claude Code in their products?" sets two conditions:
  - The binary must be "installed and run as published by Anthropic" with no authentication method removed.
  - Each end user authenticates with their own credentials.
- It also says preinstalling or running Claude Code in a product "requires agreeing to our Commercial Terms of Service".
- The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) repeats: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."
- Its branding rules forbid calling our product "Claude Code", and the Claude Code name can't be part of our UI naming.

Reading this: the map already treats T3 Code's approach (the user's own unmodified CLI, logged in through the CLI's own flow) as acceptable.

- **Hiding the terminal doesn't change who runs the OAuth flow:** it is still the `claude` binary opening Anthropic's page. That argues it stays acceptable.
- **Bundling the binary is closer to "preinstalling Claude Code in your product"**, which the page allows only under the Commercial Terms. Using the user's own install is a step further away from that clause.
- **[unverified]** Whether Anthropic sees a GUI "Sign in with Claude" button that spawns `claude auth login` as "offering Claude.ai login into their own application". This is a legal judgement; this document can't settle it.
- **Recommendation:** label the button in a way that makes clear it signs in Claude Code, e.g. "Connect your Claude subscription (opens claude.com)". Never read `.credentials.json` or the Keychain entry ourselves.

**OpenAI:**

- The Codex CLI is Apache-2.0; redistribution must keep NOTICE [src: `openai/codex` LICENSE, NOTICE].
- The app-server docs call it experimental and "not supported for production workloads" [doc: learn.chatgpt.com/docs/app-server].
- **[unverified]** I found no OpenAI terms that address third-party apps driving a ChatGPT subscription through Codex.

## Claude

### Install and detection

Official installers [doc: [setup](https://code.claude.com/docs/en/setup)]:

- **Commands:**
  - macOS, Linux, WSL: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
  - Windows CMD: `install.cmd`
- **Other channels:** Homebrew cask `claude-code`, WinGet `Anthropic.ClaudeCode`, apt/dnf/apk, and npm `@anthropic-ai/claude-code` (which downloads the same native binary through per-platform optional dependencies).
- **Install location:**
  - Native install: `~/.local/bin/claude`, a symlink into `~/.local/share/claude/versions/`, on macOS and Linux; `%USERPROFILE%\.local\bin\claude.exe` on Windows [doc: [troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install)].
  - On this machine: `~/.local/bin/claude -> ~/.local/share/claude/versions/2.1.283` [ran].
- **Other known paths** a detector should check: `~/.claude/local/` (legacy npm), the npm global prefix, Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and the WinGet location [doc: troubleshoot-install].
- **What `install.sh` does:**
  - Downloads the binary to `~/.claude/downloads`.
  - Verifies the SHA-256 against the release manifest.
  - Runs `<binary> install`, which sets up the launcher.
  - Refuses to run under sudo.
  - Exits with a Windows "not supported" message under MINGW/MSYS [src: `https://claude.ai/install.sh`].
  - So `claude install [stable|latest|version]` on any copy of the binary does the real install [ran: `claude install --help`].
- **No sudo or admin rights needed:** installs are per user [doc].
- **Windows:**
  - Git for Windows is optional. Without it, Claude uses a PowerShell tool instead of Bash [doc: setup].
  - The PowerShell execution policy blocks npm's `.ps1` shims (`claude.ps1`) but **not** the `irm … | iex` installer or the native `claude.exe`. The fix is to call `claude.cmd` or `claude.exe` directly [doc: troubleshoot-install].
  - Running the native binary directly from Electron (`child_process.spawn` of the `.exe`) never involves the execution policy.
- **Linux:**
  - Alpine/musl needs `libgcc`, `libstdc++`, `ripgrep` and `USE_BUILTIN_RIPGREP=0` [doc: setup].
  - Linux binaries are not code-signed individually; integrity comes from the signed manifest [doc: setup].
- **Auto-update:** native installs auto-update in the background. Homebrew and WinGet installs don't. `DISABLE_AUTOUPDATER` / `DISABLE_UPDATES` exist for apps that ship their own version [doc: setup].

### Bundling instead of installing

- **What ships:**
  - `@anthropic-ai/claude-agent-sdk@0.3.283` has optional dependencies `@anthropic-ai/claude-agent-sdk-{darwin,linux,linux-*-musl,win32}-{x64,arm64}` [ran: `npm view`].
  - The darwin-arm64 package contains just `claude` (about 225 MB unpacked), `LICENSE.md` ("© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements…") and a README.
  - Running it prints `2.1.283 (Claude Code)`. It is code-signed with Anthropic's Team ID `Q6L2SF6YDW` [ran].
- **The docs confirm it:** "The SDK bundles a native Claude Code binary for your platform… Most installs need no separate Claude Code install." `pathToClaudeCodeExecutable` overrides it [doc: [Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)].
- **So the same bundled binary can run `auth login`, `auth status` and `auth logout`.** No separate install step is needed.
- **Costs of bundling:**
  - About 225 MB per platform in the Electron package.
  - We ship Claude Code updates ourselves, unless we instead use the user's `~/.local/bin/claude` when it exists.
  - The Commercial Terms clause above.
- **T3 Code does the opposite.** It strips the SDK's bundled binaries with pnpm overrides ("The SDK always receives the user's Claude executable, so its bundled binaries are unused") and passes the user's `claude` path to the SDK [src: t3code `pnpm-workspace.yaml:108-116`].

### Sign in without a TTY

`claude auth login [--claudeai|--console] [--email <email>] [--sso]`. `--claudeai` (subscription) is the default [ran: `claude auth login --help`].

**Experiment [ran]:** I ran it with stdin from `/dev/null`, no TTY, `CLAUDE_CONFIG_DIR=/tmp/cc-probe` (an empty, throwaway home, so the real login was untouched) and `BROWSER=/usr/bin/true`, then killed it after 8 s. It printed:

```text
Opening browser to sign in…
If the browser didn't open, visit: <OSC-8 hyperlink> https://claude.com/cai/oauth/authorize?code=true&client_id=…&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=…&code_challenge=…&state=…
Paste code here if prompted >
```

What this shows:

- **No TTY is required.** It runs fine as a piped child process.
- **It tries to open the system browser itself,** with a localhost callback.
- **It prints a fallback URL to stdout.** That URL uses the manual-code redirect (`platform.claude.com/oauth/code/callback`), wrapped in an OSC-8 terminal hyperlink escape that we must strip.
- **It then waits for a code on stdin.** It did not exit when stdin hit EOF; it waited until it was killed.
- **The docs agree:** `claude auth login` "reads the pasted code from standard input", and it was added for cases where the browser callback can't reach localhost (WSL2, SSH, containers) [doc: troubleshoot-install; [What's new, week 18 2026](https://code.claude.com/docs/en/whats-new/2026-w18)].

The hidden flow that follows:

1. Spawn `claude auth login` with pipes. The browser opens on Anthropic's page.
2. In our UI, show "Finish signing in in your browser". Offer a link built from the printed URL, and a "paste the code shown in your browser" field in case the redirect doesn't come back.
3. Write the pasted code plus a newline to the child's stdin.
4. Wait for the process to exit, then confirm with `claude auth status`.
5. If the user cancels or it times out, kill the child ourselves, since EOF won't end it.

Unverified points:

- **[unverified]** Exact stdout on success and the exit codes. I didn't complete a login, per the ticket's constraints.
- **[unverified]** Whether `BROWSER` suppresses the auto-open on macOS. I couldn't tell whether a browser tab opened.
- **[unverified]** Whether the localhost-callback path works while stdin is a pipe. The docs imply the browser redirect completes it automatically.
- **[unverified]** The Agent SDK has no documented login method. The Authentication docs list "the Agent SDK" as a login path, and there is an `SDKAuthStatusMessage` (`type: "auth_status"`, `isAuthenticating`), but I found no public API to start a login.

### Status, account info, sign out, switch

- **`claude auth status`:**
  - It prints JSON by default: `loggedIn`, `authMethod` (`"claude.ai"`/`"none"`), `apiProvider`, `email`, `orgId`, `orgName`, `subscriptionType` (e.g. `"max"`), `configDirectory`.
  - `--text` gives human-readable output.
  - **Exit code 0 when logged in and 1 when logged out** [ran, with both the real home and the empty `/tmp/cc-probe`].
- **The SDK equivalent:** `initializationResult().account` / `accountInfo()` gives `{email, organization, subscriptionType, tokenSource, apiKeySource}` [doc: Agent SDK TypeScript]. T3 Code uses this probe instead of `auth status` [src: t3code `ClaudeProvider.ts:320-405`].
- **Sign out:** `claude auth logout` [ran: help only].
- **Switch accounts:**
  - `CLAUDE_CONFIG_DIR` moves `.credentials.json`, and on macOS it also keys the Keychain entry to that directory, "so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry" [doc: [authentication](https://code.claude.com/docs/en/authentication)].
  - This gives clean multi-account support, and it's exactly how T3 Code does it (a `homePath` per provider instance exported as `CLAUDE_CONFIG_DIR`) [src: t3code `ClaudeHome.ts:14-52`].
- **Credential storage:**
  - macOS: the Keychain, falling back to `~/.claude/.credentials.json` (mode 0600) if the Keychain is locked.
  - Linux and Windows: `~/.claude/.credentials.json` [doc: authentication].
- **Precedence gotcha:** any `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` in the environment outranks the subscription login. With `-p` an API key is always used [doc: authentication]. The app should scrub these from the child environment to keep "subscription only" true.
- **Expiry:** logins expire and show a warning 3 days ahead. Requests then fail with `Login expired · Please run /login` [doc: authentication]. The UI needs a "reconnect" state.

## ChatGPT (Codex)

### Install and detection

- **Official installers** [src: `openai/codex` `README.md:16-47`]:
  - `curl -fsSL https://chatgpt.com/codex/install.sh | sh` and `irm https://chatgpt.com/codex/install.ps1 | iex`.
  - npm `@openai/codex` and Homebrew cask `codex`.
  - GitHub release binaries, including Windows `.exe` builds for x64 and arm64.
- **Install locations:**
  - `install.sh` puts the binary at `${CODEX_INSTALL_DIR:-~/.local/bin}/codex`, keeps releases under `$CODEX_HOME/packages/standalone`, and edits the shell profile for PATH [src: `scripts/install/install.sh:16-25,580-613`].
  - `install.ps1` uses `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` [src: `scripts/install/install.ps1:939-943`].
  - Homebrew on this machine: `/opt/homebrew/bin/codex` [ran].
- **Bundling:**
  - `@openai/codex` is a thin launcher with per-platform optional dependencies [ran: `npm view`].
  - The license is Apache-2.0, so bundling is allowed as long as NOTICE is kept [src].
  - `@openai/codex-sdk` pins `@openai/codex` and runs `codex exec --experimental-json`. It has **no login or account API**, so sign-in must go through the CLI or app-server [src: `sdk/typescript/src/exec.ts`].
- **Windows:**
  - Codex now runs natively in PowerShell with a Windows sandbox; WSL is only for Linux tooling.
  - The preferred "elevated" sandbox mode **needs a UAC/admin prompt during setup**. The unelevated mode uses a restricted token [doc: learn.chatgpt.com/docs/windows/windows-sandbox].
  - The repo's `docs/install.md` still says "Windows 11 via WSL2" and looks out of date [src].
- **Linux:** the keyring backend is Secret Service over D-Bus. Machines without it need `cli_auth_credentials_store = "file"` or `"auto"` [src: `codex-rs/keyring-store/Cargo.toml`]. That this is required is inferred, not tested.

### Sign in without a TTY

- **`codex login` (browser flow):**
  - Starts a callback server on `localhost:1455`, with fallback ports, and opens the browser itself.
  - The URL goes to **stderr** inside prose text, which is fragile to parse.
  - Exits 0 on success and 1 on error [src: `codex-rs/login/src/server.rs:77,203`, `cli/src/login.rs:116-120,194-199`].
- **`codex login --device-auth`:**
  - Prints a verification URL (`…/codex/device`) and a one-time code to stdout, with ANSI colours. The code expires in 15 minutes [src: `login/src/device_code_auth.rs:149-175`].
  - It is beta and must be enabled first in the user's ChatGPT security settings; otherwise the server returns 404 "device code login is not enabled" [doc: learn.chatgpt.com/docs/auth; src]. That makes it a poor default.
- **Best path: `codex app-server`** (JSON-RPC over stdio JSONL):
  - `account/login/start {type:"chatgpt"}` → `{loginId, authUrl}`.
  - App-server does **not** open the browser itself (`open_browser: false`), so we open `authUrl` with `shell.openExternal`.
  - We then wait for the `account/login/completed {loginId, success, error}` notification.
  - `{type:"chatgptDeviceCode"}` → `{verificationUrl, userCode}` exists as an alternative.
  - Cancel with `account/login/cancel`.
  - Sources: `app-server-protocol/src/protocol/v2/account.rs:64-190,814-820`; `app-server/src/request_processors/account_processor.rs:587`.
- **[unverified]** Whether app-server's login also binds port 1455. It reuses the same login server, so probably yes. If so, two simultaneous logins, or another tool holding the port, would collide.
- **Stability:** app-server is labelled `[experimental]` and "not supported for production workloads" [doc]. It is still what T3 Code uses for Codex status, and the core `account/*` methods are not marked `#[experimental]` in source [src].

### Status, account info, sign out, switch

- **`account/read`** → `account: {type:"chatgpt", email, planType} | {type:"apiKey"} | null` and `requiresOpenaiAuth` [src: `account.rs:22-36,544-561`].
- **`account/updated`** notifications carry `{authMode, planType}` [src].
- **`account/rateLimits/read`** gives primary and secondary windows with `usedPercent`, `windowDurationMins` and `resetsAt`, plus `account/rateLimits/updated` [src]. Relevant to the map's "Usage and rate-limit display" item.
- **`codex login status`:** writes to stderr; exit 0 when logged in ("Logged in using ChatGPT"), 1 otherwise. There's no email or plan [src: `cli/src/login.rs:443-506`; ran].
- **Sign out:** `account/logout` or `codex logout`.
- **Switch accounts:**
  - A separate `CODEX_HOME` per account (default `~/.codex`) [doc]. T3 Code does this with a per-instance home plus a "shadow home" that keeps `auth.json` separate [src: t3code `packages/contracts/src/settings.ts:583-626`].
  - **[unverified]** An `account/sessions/add` method looks related to account switching; I didn't investigate it.
- **Storage:** `cli_auth_credentials_store` is `file` (default; plaintext `CODEX_HOME/auth.json`), `keyring`, `auto` or `ephemeral` [src: `codex-rs/config/src/types.rs:115-125`; doc]. We should set `auto` so tokens go to the OS keychain when one is available.

## Finding the CLIs from a GUI app (both providers)

- **The problem:** GUI apps launched from the Dock, Finder or Start menu don't inherit the shell PATH, so `claude` / `codex` on PATH is not a reliable test.
- **How T3 Code solves it** [src: t3code]:
  - **POSIX:** runs `$SHELL -ilc` (falling back to the login shell, then zsh/bash) to capture PATH. On macOS it falls back further to `launchctl getenv PATH`, then merges the result (`packages/shared/src/shell.ts:160-200,293-316`; `apps/server/src/os-jank.ts:51-92`).
  - **Windows:**
    - Reads PATH from `pwsh`/`powershell -NoProfile`.
    - Adds known folders (`%APPDATA%\npm`, `%USERPROFILE%\.local\bin`, scoop shims, and others).
    - Resolves against PATHEXT, and runs `.cmd` / `.bat` files through the shell (`shell.ts:337-455,685-803`).
    - Follows npm shims to the real `claude.exe` (`apps/server/src/provider/Drivers/ClaudeExecutable.ts`).
  - **Detection itself** is `claude --version` / spawning `codex app-server`, where a spawn error means not installed (`ClaudeProvider.ts:461-487`, `CodexProvider.ts:588-610`).
- **Recommendation:**
  - If we bundle both binaries, detection matters only for the optional "use my existing install" path.
  - Otherwise, check the known install paths listed above first, then an imported login-shell PATH.

## How T3 Code does onboarding (for comparison)

Sources are t3code `de251fc2`.

- **Wizard:** Connect → Agents → Projects (`apps/web/src/components/onboarding/WelcomeWizard.tsx:89-93`).
  - Each provider card shows Ready, Install, Sign in or Attention, from `getOnboardingProviderState` (`apps/web/src/onboarding/providerReadiness.logic.ts:36-43`).
- **Install and Sign in both open an embedded terminal** (node-pty on the server, a libghostty-vt WASM renderer in the UI). The command is **typed in but not run**, under the header "Review the command, then press Enter to run it." (`WelcomeWizard.tsx:803-935`).
- **Commands used:**
  - Install: the official installer for the server's OS (`providerReadiness.logic.ts:79-102`).
  - Login: `<binary> auth login` and `<binary> login` (`:105-129`).
- **Status:**
  - Claude uses the SDK init probe (`ClaudeProvider.ts:320-405`). It seems never to report `unauthenticated`, so a logged-out Claude may show "attention" instead of "Sign in" [unverified].
  - Codex uses app-server `account/read` (`CodexProvider.ts:411-557`).
- **No in-app login and no sign-out for Claude or Codex.** T3 Code never calls `account/login/start` or `account/logout`. A generic in-app auth-flow framework (browser / device code) exists, but only its Antigravity driver implements it (`apps/server/src/provider/Drivers/AntigravityDriver.ts:495`).
- **No PowerShell execution-policy handling;** `irm | iex` isn't affected by it anyway. WSL gets its own backend, and the install command follows the backend's OS.

T3 Code's audience is developers, which explains the terminal-first approach. Everything it does in the terminal can be done without one, as shown above.

## Per-OS summary

- **macOS:**
  - Both bundled binaries are signed by their vendors. Claude's carries Anthropic's Team ID (verified). The Codex binary signature is **[unverified]**.
  - Keychain holds the Claude token, and Codex's with `auto`.
  - GUI PATH problem, avoided by bundling or by checking known paths.
  - Browser sign-in works with the localhost callback.
- **Windows:**
  - Spawn `claude.exe` / `codex.exe` directly and the execution policy never matters. It only affects npm `.ps1` shims.
  - No admin rights for either install.
  - Codex's elevated sandbox asks for UAC once. Consider the unelevated mode to avoid the scary prompt (**[unverified]** what that trades away).
  - Claude works without Git for Windows by using the PowerShell tool.
  - WSL isn't needed for either.
- **Linux:**
  - Codex keyring needs a Secret Service daemon; otherwise use `file`/`auto`. Claude always uses a 0600 file.
  - musl distros need extra packages for Claude.
  - `xdg-open` must work for the browser to open. Our UI must always also show the URL.

## Fallbacks, in order

1. **Hidden flow** (recommended): bundled binaries, `claude auth login` over pipes with a paste-code field, and Codex app-server `account/login/start`.
2. **If the browser callback fails:**
   - Claude: the paste-code field in our UI.
   - Codex: `chatgptDeviceCode` in our UI, telling the user to enable device login in ChatGPT settings.
3. **If a vendor changes the non-TTY behaviour:** run the same command in a node-pty pseudo-terminal we keep hidden, and parse the output.
4. **Last resort** (T3 Code's approach): an embedded terminal panel inside our window with the command pre-typed.

## Not verified

- Output and exit codes of a completed `claude auth login` (I never completed one), and whether `BROWSER` stops the auto-open on macOS.
- A public Agent SDK login API.
- Anthropic's view of a GUI button that spawns `claude auth login`, and whether bundling the SDK's binary triggers the Commercial Terms requirement for a free, non-commercial app.
- OpenAI terms for third-party apps using a ChatGPT subscription through Codex.
- Whether Codex app-server login binds port 1455, and the `account/sessions/add` method.
- Codex binary code signing on macOS and Windows.
- The Windows and Linux behaviour described here comes from docs and source. Nothing was run on those OSes.
