# Would `claude setup-token` have been a better way to sign in to Claude?

Research for the `claude setup-token` question in [Reconnect, offline and error states](https://github.com/qodesmith/unimatrix-zero/issues/40), part of the [v1 spec map](https://github.com/qodesmith/unimatrix-zero/issues/1). It tests the sign-in decision from [Can sign-in and CLI install be fully hidden?](https://github.com/qodesmith/unimatrix-zero/issues/4) and [ADR 0008](../adr/0008-app-managed-vendor-programs.md) (the unmodified `claude auth login` in an app-managed `CLAUDE_CONFIG_DIR`) against the alternative: a long-lived token from `claude setup-token`, passed as `CLAUDE_CODE_OAUTH_TOKEN`. Researched 2026-10-11.

**Why it came up:** the Claude CLI signs users out at random, sometimes after weeks and sometimes after days. A one-year token that never refreshes looks like a fix.

## Sources and method

| Thing | Version |
| --- | --- |
| Claude Code | 2.1.296 (build `fdb6c17a`, 2026-10-09), the user's installed native binary, read as strings only |
| `@anthropic-ai/claude-agent-sdk` | 0.3.296 (bundles Claude Code 2.1.296), from `npm pack`; `sdk.d.ts` and `sdk.mjs` read only |
| Claude Code docs | `code.claude.com/docs/en/*.md`, fetched 2026-10-11 |
| Claude Code `CHANGELOG.md` | `anthropics/claude-code` `main`, fetched 2026-10-11 |
| T3 Code | `pingdotgg/t3code` `18656a34` (2026-10-11), shallow clone |
| Electron `safeStorage` docs | `electron/electron` `main`, `docs/api/safe-storage.md` |

Every claim is tagged:

- **[doc]**: Anthropic's or Electron's documentation.
- **[src]**: the Claude Code binary or the Agent SDK package (minified JavaScript, so names like `tG()` are the minifier's), or T3 Code's source.
- **[issue]**: an `anthropics/claude-code` or `pingdotgg/t3code` issue or PR. Most reports come from users, not Anthropic; where an Anthropic collaborator or T3 maintainer said something, it says so.
- **[unverified]**: could not be confirmed.

Nothing was run against the user's account. `claude setup-token` was not run, no sign-in was started, and no credential was read. Downloads went into fresh, empty folders under `/tmp`; the binary and the clone were only read.

---

## Verdict

**No. `setup-token` would not have been the better route, and it should be rejected as a product feature.** It does remove one cause of random sign-outs (refresh races), but:

1. **It breaks the rules we already have.** The app would have to capture or collect the token, store it, and hand it to every `claude` it starts. Anthropic's terms say developers "may not collect, store, or intermediate Claude.ai credentials or session tokens" [doc: legal]. That is exactly the line #4's policy note relies on ("we never touch the token"), and it also breaks #13's no-secrets rule and #39's stripping of `CLAUDE_CODE_OAUTH_TOKEN`.
2. **It is inference-only.** The token carries only the `user:inference` scope [src], so the app loses the account's email and plan, the usage meter (`get_usage`), claude.ai connectors and synced skills, and, through open bugs, correct access to some Models [doc, issue].
3. **Anthropic positions it for CI pipelines and scripts** [doc: authentication], not for apps that sign end users in.
4. **The sign-out problem is better attacked where it starts.** Most random sign-outs come from how `claude` processes refresh a shared login: races, refreshes started and then abandoned, and failure paths that wipe the stored login. The app can avoid most of these triggers without holding a token (see [What #40 should adopt](#what-40-should-adopt)).

---

## 1. What `setup-token` is

### What it does

- **It runs the normal OAuth sign-in and prints the token.** "The command opens the same browser authorization flow as `/login`, and the token prints to the terminal after you approve access in the browser. It does not save the token anywhere; copy it and set it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable" [doc: [authentication § Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)]. The CLI reference says the same: "Prints the token to the terminal without saving it. Requires a Claude subscription" [doc: [cli-reference](https://code.claude.com/docs/en/cli-reference)].
- **What the code does** [src]:
  - The handler shows "This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required."
  - It starts the OAuth flow with `inferenceOnly: true` and `expiresIn: 31536000` (365 days).
  - On success it keeps only `accessToken` and `expiresAt`. No refresh token is stored, and nothing is written to the credential store.
  - It then prints "Your OAuth token (valid for …)", "Store this token securely. You won't be able to see it again." and "Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>".
- **Managed policy can refuse it:** "setup-token creates a long-lived Claude.ai subscription token, which this policy does not permit" (under `forceLoginMethod`), and the same for `allowedProviders` [src]. The docs add that `setup-token` enforces only `forceLoginMethod` [doc: authentication].

### Lifetime, scope and refresh

| Property | Value | Source |
| --- | --- | --- |
| Lifetime | One year | [doc: authentication] "a one-year OAuth token"; [src] `LZ=31536000` |
| Scope | `user:inference` only | [src] the authorize URL takes `scopes = inferenceOnly ? ["user:inference"] : …` |
| Refresh | None. When the env token is used, the credential is built as `{accessToken: env, refreshToken: null, expiresAt: null, scopes: CLAUDE_CODE_OAUTH_SCOPES ?? ["user:inference"], subscriptionType: CLAUDE_CODE_SUBSCRIPTION_TYPE ?? null, …}` | [src] `tG()`; [doc: env-vars] "To replace an expired token, generate a new one and restart" |
| After a 401 | The CLI keeps sending the env token. It does not fall back to a stored login | [doc: [errors § OAuth token revoked or expired](https://code.claude.com/docs/en/errors#oauth-token-revoked-or-expired)]; [src] log line "OAuth 401: keeping the user-supplied CLAUDE_CODE_OAUTH_TOKEN instead of adopting the stored credential. Mint a fresh token with `claude setup-token` and restart with it" |
| Precedence | 5th: above `/login` credentials, below `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` and `apiKeyHelper` | [doc: authentication § Authentication precedence] |
| `--bare` mode | Does not read the variable | [doc: authentication] |

### How it is supplied

- **Documented: an environment variable only.** `CLAUDE_CODE_OAUTH_TOKEN`, set in the shell or in a settings file's `env` block [doc: authentication, env-vars].
- **Undocumented: a file descriptor.** The binary also reads `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` and a "well-known path" OAuth token file [src]. Neither appears in [env-vars](https://code.claude.com/docs/en/env-vars) [doc], so neither is a supported interface.
- **The Agent SDK has a host token callback.** `sdk.mjs` handles a control request `oauth_token_refresh` by calling a host `getOAuthToken` callback, and the CLI refers to `CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH` [src]. Neither is in the public `sdk.d.ts` [src]. A user comment says Claude Desktop feeds its bundled engines through `CLAUDE_CODE_OAUTH_TOKEN` [issue: [#88583](https://github.com/anthropics/claude-code/issues/88583), comment by mannyb223]. Either way, this is a host-owns-the-refresh-token design, which is closed to third parties (section 2).
- **There is no CLI command to list or revoke tokens.** Requests for one were closed as stale [issue: [#57400](https://github.com/anthropics/claude-code/issues/57400), [#48373](https://github.com/anthropics/claude-code/issues/48373)]. The GitHub Actions docs warn: "If you delete a secret, the credential it held stays valid" [doc: [github-actions](https://code.claude.com/docs/en/github-actions)]. The errors page says a revoked token "means you signed out everywhere or an admin removed access" [doc: errors]. **[unverified]** Which claude.ai action revokes a `setup-token` token.

### What works and what doesn't

| Feature | With a `setup-token` token | Source |
| --- | --- | --- |
| Model requests (Agent SDK, `claude -p`, interactive) | Yes | [doc: authentication] "It can only make model requests" |
| `claude auth status` | `authMethod: "oauth_token"`; logged in | [doc: cli-reference] lists `oauth_token` among the `authMethod` values |
| Email and organization | **No.** `oauthAccount` stays null under token auth, and `/status` shows only that a token is active | [issue: [#90298](https://github.com/anthropics/claude-code/issues/90298)]; [src] `Hn()` returns `oauthAccount` only for stored logins |
| Plan (`subscriptionType`) | **No.** Only what the host puts in `CLAUDE_CODE_SUBSCRIPTION_TYPE`. A T3 Code user measured `account.subscriptionType: undefined` from `initializationResult()` on a Max account | [src] `tG()`; [issue: [t3code#13053](https://github.com/pingdotgg/t3code/issues/13053#issuecomment-6000368527)] |
| Experimental `get_usage` | **No.** `rate_limits_available: false` (same T3 measurement). The usage endpoint needs `user:profile`; a token got "403 … OAuth token does not meet scope requirement user:profile" | [issue: t3code#13053; [#81015](https://github.com/anthropics/claude-code/issues/81015)] |
| `rate_limit_event` during a Turn | Probably yes: the limit headers come back on inference responses. A user reports "unified rate-limit headers confirm subscription billing on token sessions too" | [issue: [#83900](https://github.com/anthropics/claude-code/issues/83900)]; **[unverified]** by us |
| Model access | **Unreliable.** Inference-only tokens "cannot read plan/entitlement information", so the client falls back to a usage-credits prompt for Fable 5; an Anthropic collaborator confirmed this as a bug. Other reports cover Models disabled, a silent switch to Sonnet 5, and Fable 5.1 missing from the picker. The community workaround is to set `CLAUDE_CODE_SUBSCRIPTION_TYPE` by hand | [issue: [#79360](https://github.com/anthropics/claude-code/issues/79360) (bcherny, collaborator, 2026-08-17), [#73350](https://github.com/anthropics/claude-code/issues/73350), #83900, [#91852](https://github.com/anthropics/claude-code/issues/91852) (open)] |
| Local MCP servers | Yes | [doc: authentication] "MCP servers you configure locally still work" |
| claude.ai connectors | **No** | [doc: authentication] "can't … fetch claude.ai connectors" |
| claude.ai synced skills | Probably no: the provider-sdk-options research saw nothing synced with an env token | [provider-sdk-options research](https://github.com/qodesmith/unimatrix-zero/blob/research/provider-sdk-options/docs/research/provider-sdk-options.md); **[unverified]** with a real `setup-token` token |
| Remote Control, Claude in Chrome | No | [doc: authentication]; [src] "Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token` or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only" |
| Agent SDK | Yes, through `env` on `query()`. The docs name the variable as an "Alternative to `/login` for SDK and automated environments" | [doc: env-vars] |
| Expiry or revocation | Each request fails with `Failed to authenticate. API Error: 401 OAuth token has expired` or `OAuth token revoked`, error code `authentication_failed`. There is no advance warning: the 3-day expiry warning only covers `/login` credentials | [doc: errors; authentication § "The warning appears only when a claude.ai login is the active credential"] |
| Parallel use of one token | One report of a 5-10 s server-side slowdown when parallel processes share a token (closed as stale) | [issue: [#54999](https://github.com/anthropics/claude-code/issues/54999)]; **[unverified]** today |

### Is it meant for CI and headless use only?

**Yes, by every Anthropic description:**

- "For CI pipelines, scripts, or other environments where interactive browser login isn't available" [doc: authentication].
- "Use this for CI pipelines and scripts where browser login isn't available" [doc: authentication § precedence].
- "Generate a long-lived OAuth token for CI and scripts" [doc: cli-reference].
- `/install-github-app` mints the same kind of token for a GitHub Actions secret [src; doc: github-actions].
- The errors page offers it "For automation that can't sign in interactively" [doc: errors].

Nothing documents it as a sign-in for a desktop app.

---

## 2. Anthropic's terms

From [Legal and compliance → Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance) [doc]:

> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication … Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.

and the carve-out:

> Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription …

**What this means for each design:**

- **The current design** (#4): the unmodified binary runs OAuth and keeps its own credential, and the app never reads it. That fits the carve-out. Whether a GUI button counts as "offer[ing] Claude.ai login" stays **[unverified]**, as #4 already says.
- **`setup-token` inside the app:** the sign-in itself still completes through Anthropic's flow, since the unmodified binary runs it. After that, though, the app has to:
  - **collect** the token, by reading the binary's stdout or a field the user pastes it into;
  - **store** it, because it must outlive the process and app restarts;
  - **intermediate** it, by injecting it into every `claude` it spawns.

  That is all three verbs the terms forbid. No Anthropic document allows an exception for tokens the user minted themselves.
- **The CI wording doesn't help us.** The paragraph that allows provisioning credentials "in a development environment, secrets manager, or machine image" covers only "their own API keys or third-party inference provider credentials" [doc], not subscription tokens.
- **The Agent SDK overview** repeats: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products" [doc: [agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)].
- **Enforcement history** (from the [subscription-terms research](https://github.com/qodesmith/unimatrix-zero/blob/research/subscription-terms/docs/research/subscription-terms.md)): the tools that got blocked, or pressed by Anthropic's lawyers, were ones that took the subscription OAuth token and used it themselves (OpenCode's `opencode-anthropic-auth`). An app that holds a `setup-token` token moves us toward that group and away from the Conductor and OpenClaw pattern.
- **T3 Code's maintainers drew the line even earlier.** They closed a PR that added an in-app "re-authenticate" button running `claude setup-token`. Their reason: "we do not want to offer or automate Claude.ai subscription login recovery inside T3 Code … given the concerns around Anthropic's restrictions on third-party use of subscription OAuth and Claude.ai login flows" [issue: [t3code#4151](https://github.com/pingdotgg/t3code/pull/4151)]. Their line is stricter than ours (#4 hides `claude auth login` behind a button); this is a separate risk, already tracked in #4.

---

## 3. Conflicts with #13, #4 and #39

| Rule | What `setup-token` needs | Conflict |
| --- | --- | --- |
| #13 "the app keeps no secrets of its own (no `safeStorage`)" | Store a one-year bearer token per account | **Direct.** #13 says that adding `safeStorage` means revisiting the update decision |
| #4 "the unmodified binary runs OAuth and we never touch the token" | Read the token from stdout, or have the user paste it, then pass it on | **Direct** (section 2) |
| #39 strip `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` from the vendor programs | Inject that same variable | **Direct.** The strip exists because these variables "silently override the subscription" sign-in |

**Where the token would live, if we did it anyway:**

- **Electron `safeStorage`:**
  - macOS: the key lives in the Keychain [doc: [safe-storage](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)].
  - Windows: DPAPI protects it from other users "but not from other apps running in the same userspace" [doc].
  - Linux: with no secret store it falls back to `basic_text`, "encrypted via hardcoded plaintext password" [doc].
- **Keychain prompts on Mac:** the docs warn that without a consistent signature "macOS may not recognize different builds of your app as the same application, which can cause the Keychain to re-prompt the user for permission on every update" [doc]. #13's experiment confirmed this for our ad-hoc signed builds: each `cdhash` change brings a Keychain prompt. The thin shell avoids it for app-bundle updates but not for shell updates.
- **The token also leaves the app.** It would sit in the environment of every `claude` process. Workspaces let the model run shell commands. The binary has code that withholds Anthropic credential variables from child processes, and the variable is on its lists [src], but **[unverified]** whether the Bash tool's children are always scrubbed outside the HIPAA path.
- **T3 Code's equivalent** is per-instance "Sensitive" environment variables, kept as `0600` files in a `0700` secrets folder [src: t3code `apps/server/src/auth/ServerSecretStore.ts:161-237`]. Those are plaintext on disk, not `safeStorage`.

**When the token expires or is revoked:**

- **Every request fails with a 401** (`authentication_failed`), and the CLI keeps resending the dead token [doc: errors].
- **The app finds out mid-Reply.** There is no `refreshTokenExpiresAt` and no 3-day warning for env tokens [doc: authentication]. The app would have to track the minting date itself.
- **It can't be revoked from the app.** There is no revoke command [issue: #57400], so signing out of the app couldn't kill the token, only forget it.
- **Recovery means running `setup-token` again** and replacing the stored secret. That is the same browser round-trip as `claude auth login`, so a dead token is no easier to fix than a dead sign-in.

---

## 4. Would it fix the random sign-outs?

### Why the CLI signs users out

How the CLI keeps a stored login alive:

- **Lifetimes.** The access token lasts about 8 hours. Users report a refresh-token lifetime of about 4 weeks ("~28-day", "about 29 days") [issue: [#88947](https://github.com/anthropics/claude-code/issues/88947), #88583 comment by andybergon, [#96076](https://github.com/anthropics/claude-code/issues/96076)].
- **When refresh runs.** A process refreshes when the access token is within 5 minutes of `expiresAt` [issue: [#91708](https://github.com/anthropics/claude-code/issues/91708), [#95822](https://github.com/anthropics/claude-code/issues/95822), both quoting the shipped code].
- **What the refresh does** [src: `Kl()`, `RSe()`]:
  - It takes a lock file in the config folder (`Lw()` = `CLAUDE_SECURESTORAGE_CONFIG_DIR` or the config folder).
  - It re-reads the stored credential under the lock. If another process already rotated it, it adopts the new tokens (`tengu_oauth_token_refresh_race_resolved`).
  - Otherwise it posts `grant_type=refresh_token` and saves the new refresh token the server returns.
- **The docs describe the coordination:** "Parallel sessions on one machine share a saved login and coordinate its renewal so that only one process refreshes the token at a time" [doc: [troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install#not-logged-in-or-token-expired)].
- **When a refresh fails with `invalid_grant`,** the CLI marks the refresh token dead and **blanks the stored credential** (`accessToken: "", refreshToken: "", expiresAt: 0`). Every process is then signed out ("Login expired") [src: `QEr()`; doc: [errors § Login expired](https://code.claude.com/docs/en/errors#login-expired)].

Known ways a login ends early:

1. **Two processes refresh with the same refresh token.** Refresh tokens rotate, and reuse revokes the login. The docs say so for an older race: "Before v2.1.211, waking the machine from sleep could cause two sessions to renew with the same token, which revoked the saved login" [doc: troubleshoot-install]. The changelog lists a long run of fixes in this area [doc: CHANGELOG]:
   - 2.1.126, 2.1.129, 2.1.133 ("parallel sessions all dead-ending at 401 after a refresh-token race wiped shared credentials") and 2.1.136;
   - 2.1.248, 2.1.265 ("VS Code and SDK sessions occasionally requiring re-login when a session was closed while refreshing its token");
   - 2.1.277 ("logged out when an older Claude Code build … runs on the same machine"), 2.1.282 and 2.1.285.
2. **Short-lived processes that start a refresh and exit before saving it** [issue: #95822, open].
   - Every command runs an init step that, if the token is near or past expiry, starts a refresh without waiting for it. `claude auth status`, `doctor` and `agents --json` then exit straight away.
   - If the request reached the server, the refresh token is spent but the new one was never stored. The next refresh gets `invalid_grant` and the login is wiped.
   - Reporters hit this through monitoring scripts, login banners and tools that run `claude auth status` before each use.
   - In 2.1.296 the init still starts the refresh without awaiting it (`Iho(…).catch(c)`). Non-session commands skip it only when the server-side flag `tengu_quizzical_giraffe` is on [src]. **[unverified]** whether that flag is on for our users.
3. **Credentials wiped while concurrent sessions run.** These reports post-date the lock:
   - 5 Desktop engines, wiped every 1-3 days, caught on the Keychain item [issue: #88583, open].
   - 13 concurrent CLIs on one Keychain item [issue: [#80085](https://github.com/anthropics/claude-code/issues/80085)].
   - 10-24 tmux sessions, about weekly [issue: #88947].
   - Windows file-store contention, still reproducing with the lock on 2.1.282-2.1.295 [issue: #91708].
   - A comment on #88583 reports the same signature on two separate `CLAUDE_CONFIG_DIR` Keychain items on 2.1.257.

   Two of these name **T3 Code** as the trigger ("making my t3 code unusable", "recurring problem on T3 Code on Ubuntu") [issue: #88583 comments].
4. **The refresh token's own expiry.**
   - In #88583's log the stored `refreshTokenExpiresAt` was 1789311384942 (2026-09-13 UTC). That is about 27 days after the 08-17 sign-in, and eight successful rotations had not moved it.
   - The CLI keeps the old value whenever the server doesn't send a new one [src: `Fk()` merges `refreshTokenExpiresAt ?? previous`].
   - That points to a **fixed ~4-week sign-in lifetime**, which would explain the "after weeks" sign-outs. The docs' advance warning ("Your login expires in 3 days") fits a known hard expiry [doc: authentication].
   - **[unverified]**: Anthropic doesn't document the refresh-token lifetime, or whether it ever slides.
5. **Sharing one login across config folders or tools.** Copied or symlinked `.credentials.json` [issue: [#76561](https://github.com/anthropics/claude-code/issues/76561)], or Desktop and the terminal CLI on one Keychain item [issue: [#94464](https://github.com/anthropics/claude-code/issues/94464), [#98693](https://github.com/anthropics/claude-code/issues/98693)]. ADR 0008's separate `CLAUDE_CONFIG_DIR` already removes this for the app.

So: **the "days" sign-outs are mostly causes 1-3, and the "weeks" sign-outs are probably cause 4.**

### Is our app exposed?

**Yes, to causes 1-4.** ADR 0008 removes cause 5, but inside its own config folder the app runs several `claude` processes at once. That is the setup in #88947, #80085 and #88583.

Things the app may do that make it worse:

- **Short-lived probes.** The usage-data research suggested starting a query with a held-back input, calling `get_usage`, and closing it. #40 floats checking `claude auth status` before each Prompt. Both are the short-lived-process trigger from cause 2. T3 Code does the first one every 5 minutes: a never-yielding `query()` that reads `initializationResult()` and `get_usage`, then aborts [src: t3code `apps/server/src/provider/ClaudeProvider.ts:362-420`, `Drivers/ClaudeDriver.ts:78` `CAPABILITIES_PROBE_TTL = Duration.minutes(5)`]. That may be why T3 users show up in #88583. **[unverified]** link.
- **Killing processes.** The CLI waits up to 2 s for a refresh in flight on a graceful exit (`waitForHeldOAuthRefresh`, `evr=2000`) [src]. The SDK's close sends `SIGTERM`, then `SIGKILL` after 5 s [src: `sdk.mjs`]. A `SIGKILL` sent first, or a utility process that dies and takes its children with it, skips that wait. **[unverified]** whether a `claude` that sees its stdin close takes the graceful path.

### Would `setup-token` fix it?

**For causes 1-4, yes.** Sessions on `CLAUDE_CODE_OAUTH_TOKEN` "don't use the saved login and never see" `Login expired` or the refresh-lock error [doc: errors]. There's no refresh token to race, abandon or wipe. Users in #88583, #98693 and [#76905](https://github.com/anthropics/claude-code/issues/76905) recommend exactly this workaround for tools that launch many processes [issue].

**What it costs:**

- the policy and rule conflicts in sections 2-3;
- the features lost in section 1;
- a hard one-year cliff with no warning;
- possibly slower parallel requests [issue: #54999];
- #76905's summary: "setup-token workaround strips claude.ai connectors, leaving no viable headless pattern".

### Mitigations without a token

- **Don't start short-lived `claude` processes** against the app's config folder on a timer. Ask the processes that are already running (`initializationResult().account`, `get_usage` on a live query, `rate_limit_event`), and treat `authentication_failed` as the signal.
- **Close `claude` processes gracefully**, through the SDK's close, so they get their 2-second refresh wait. Don't send `SIGKILL` first.
- **Keep the number of long-lived idle processes small.** Each one is a refresh contender.
- **Keep the CLI current.** Auth fixes land often (cause 1), and ADR 0008's weekly bump picks them up. Watch #88583, #95822 and #91708.
- **Expect a monthly re-sign-in** (cause 4, unverified), and make it cheap: the reconnect card.

---

## 5. T3 Code

**How it handles Claude sign-in today** (`18656a34`):

- **It uses the user's own CLI login.** "T3 Code uses Claude Code's login and configuration." Separate accounts are separate `CLAUDE_CONFIG_DIR`s, logged in from a terminal with `CLAUDE_CONFIG_DIR=… claude auth login` [src: `docs/user/providers-claude.md:3-30`].
- **It sets only `CLAUDE_CONFIG_DIR`.** `makeClaudeEnvironment` sets it and leaves `HOME` alone, so the macOS Keychain lookup still works. **It does not strip `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`**; the inherited environment passes through [src: `apps/server/src/provider/Drivers/ClaudeHome.ts:36-54`; grep found no stripping].
- **Onboarding pre-types `claude auth login`** (not `setup-token`) in an embedded terminal: "Review the command, then press Enter to run it." [src: `apps/web/src/onboarding/providerReadiness.logic.ts:107-118`, `apps/web/src/components/onboarding/WelcomeWizard.tsx:1139`].
- **Status and plan come from a periodic SDK probe** (`initializationResult().account`, then `get_usage`). Auth is judged from `tokenSource` / `apiKeySource` / `email` / `subscriptionType` [src: `apps/server/src/provider/ClaudeProvider.ts:184-199, 221-254, 362-420`].
- **No `safeStorage` for provider credentials.** `safeStorage` is used only for saved remote environments and the connection catalog [src: `apps/desktop/src/settings/DesktopSavedEnvironments.ts:230-274`, `apps/desktop/src/app/DesktopConnectionCatalogStore.ts:384-485`]. Instance env vars marked Sensitive go to `0600` files [src: `ServerSecretStore.ts`]. The docs use this for router keys (`ANTHROPIC_AUTH_TOKEN` for OpenRouter), not Claude tokens [src: `docs/user/providers-claude.md:79-93`].

**Searches for `setup-token` and `CLAUDE_CODE_OAUTH_TOKEN`:**

- **Code:** no hits for either string in the clone (excluding vendored `.repos/`). `gh search code` returned nothing for either.
- **Issues and PRs:**
  - [t3code#4151](https://github.com/pingdotgg/t3code/pull/4151): a PR for a "re-authenticate Claude" button running `claude setup-token` in the integrated terminal. **Closed by the maintainers** as "a product and compliance-risk decision" (quoted in section 2).
  - [t3code#13053](https://github.com/pingdotgg/t3code/issues/13053) (open, confirmed by maintainer juliusmarminge): Claude usage silently missing. A commenter showed that a `setup-token` token gives `subscriptionType: undefined` and `rate_limits_available: false`. It's common for T3 over SSH, where "the macOS keychain is locked in an SSH session, so a setup token is the usual way to sign Claude in there".
  - [t3code#2653](https://github.com/pingdotgg/t3code/issues/2653) (closed): "could not verify authentication status". One reporter used `CLAUDE_CODE_OAUTH_TOKEN` in a headless container.
  - [t3code#15836](https://github.com/pingdotgg/t3code/pull/15836) (open): detects a signed-out CLI (`tokenSource: "none"`) and then runs `claude auth status` to confirm.

**Takeaway:** T3 Code doesn't offer `setup-token`, explicitly rejected automating Claude sign-in, and its users who bring their own `setup-token` lose usage limits and plan display.

---

## 6. Recommendation

**Reject `setup-token` as a product feature, and record why in #40** (or an ADR next to 0008):

- It conflicts with Anthropic's "collect, store, or intermediate" rule, #4, #13 and #39.
- It's documented for CI and scripts, not end-user apps.
- It drops email, plan, usage, connectors and reliable Model access, which the onboarding "Check your plan" step (#16) and the usage display (#36) both depend on.
- It moves the problem from "random sign-out" to "silent one-year cliff and a secret to protect".

**Not even as an opt-in in the UI.** A "paste your token" field still means the app collects and stores it. If power users need it, the only version that keeps the rules is a **developer-only environment variable**, like ADR 0008's custom-binary escape hatch. With it set, the app stops stripping an inherited `CLAUDE_CODE_OAUTH_TOKEN`, so a user who launches the app with their own token in the environment gets it passed through. The app never stores it, shows it, or asks for it, and the UI marks usage and plan as unavailable. That is optional and low priority. **[unverified]** whether Anthropic would see even a pass-through as "intermediating".

## What #40 should adopt

1. **Keep** `claude auth login` in the app-managed `CLAUDE_CONFIG_DIR`. Keep #39's stripping of `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`) as the default.
2. **No timer-based `claude auth status`** and no throwaway probe processes.
   - **Signed in or not:** read `initializationResult().account` from sessions the app starts anyway, plus the SDK's `authentication_failed` errors.
   - **When to run `claude auth status`:** only at launch, after Connect, and after an auth error.
   - **Usage data:** call `get_usage` on a query that is already alive. If a dedicated probe is unavoidable, keep it open rather than starting one per poll. This changes the usage-data research's "start a query … call it, and close" advice.
3. **Close `claude` processes gracefully** (SDK close → `SIGTERM`; the CLI waits up to 2 s for a refresh in flight). On quit and Stop, close sessions before tearing down the utility process. **Test in the build** whether a utility-process crash (children see stdin close) leaves a spent refresh token.
4. **Keep idle Claude processes few.** Reuse one live session per Thread; don't keep spares per Thread.
5. **Classify errors** (wording from [doc: errors]):
   - `Login expired` / `Failed to authenticate: OAuth session expired and could not be refreshed` / `OAuth token revoked` → **reconnect** card.
   - `Failed to refresh OAuth token: another Claude Code process is refreshing it …` (`server_error`) → **retry after a pause**, not reconnect.
6. **Expect sign-ins to end about every 4 weeks** (unverified). If the CLI exposes the expiry, warn ahead like the CLI's 3-day notice. **[unverified]** whether any SDK or `auth status` field reports `refreshTokenExpiresAt`; otherwise rely on the reconnect card.
7. **Track upstream:** #88583, #95822, #91708 and #88947. Re-test after CLI bumps. A spike that runs N concurrent SDK sessions on one throwaway login across an 8-hour access-token boundary would show whether the app's pattern survives.

## Not verified

- Which claude.ai action revokes a `setup-token` token, and whether a password change or "sign out everywhere" does.
- The refresh-token lifetime (users report about 28-30 days) and whether it ever slides. That the "weeks" sign-outs are this hard expiry is an inference from one user's log plus the CLI's merge code.
- Whether the server-side flag `tengu_quizzical_giraffe` (which stops non-session commands from starting a refresh) is on.
- `rate_limit_event` under a `setup-token` token, and claude.ai synced skills under one. Both come from user reports or analogy, not from a test.
- Whether the Bash tool's children see `CLAUDE_CODE_OAUTH_TOKEN` outside the HIPAA path.
- Whether a `claude` that loses its stdin (utility process death) waits for a refresh in flight.
- That T3 Code's 5-minute probe causes its users' wipes in #88583. The mechanism fits, but nobody has shown the link.
- Anthropic's view of a pass-through of a user-set environment token.
- The undocumented `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` and the SDK `getOAuthToken` callback: seen in code only, not public interfaces.
