# Provider SDK options for MCP servers, skills and process model

Research for [Provider SDK options for MCP servers, skills and process model](https://github.com/qodesmith/unimatrix-zero/issues/37), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). It unblocks the grilling ticket [Provider drivers, process model and IPC event list](https://github.com/qodesmith/unimatrix-zero/issues/38). Researched 2026-10-09.

**Question:** what do the Claude Agent SDK and `codex app-server` expose for MCP servers, skills and process placement when each Provider runs with its own `CLAUDE_CONFIG_DIR` / `CODEX_HOME` ([ADR 0008](../adr/0008-app-managed-vendor-programs.md), [#20](https://github.com/qodesmith/unimatrix-zero/issues/20))?

## Sources and method

| Thing | Version |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.295 (bundles Claude Code 2.1.295, the same pin as [#31](https://github.com/qodesmith/unimatrix-zero/issues/31)) |
| `codex` | `@openai/codex@0.160.1` from npm (the same pin as #31); source at tag `rust-v0.160.1`, paths relative to `codex-rs/` |
| Electron | 44.7.0 (`latest` on npm on 2026-10-09) |

- **Claude:** `sdk.d.ts` in the npm package (quoted as **[sdk.d.ts]**). Docs fetched as Markdown on 2026-10-09: [Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills.md), [Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp.md), [Agent SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins.md), [Claude Code MCP](https://code.claude.com/docs/en/mcp.md), [Claude Code skills](https://code.claude.com/docs/en/skills.md).
- **Codex:** the Rust source (quoted as **(source: path)**) and the app-server protocol types in `app-server-protocol/src/protocol/v2/`.
- **Electron:** [`utility-process.md` at v44.7.0](https://github.com/electron/electron/blob/v44.7.0/docs/api/utility-process.md) and the electron/electron issue tracker.

**Live tests.** Claims marked **(verified live)** were run on 2026-10-09 with throwaway scripts in `/tmp`, outside the repo.

- **Claude:** `CLAUDE_CONFIG_DIR` was a fresh temp folder. Auth came from the user's current Claude Max access token, passed only as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable (read from the Keychain, never written to disk, no refresh token involved). `ANTHROPIC_API_KEY` was stripped; init reported `apiKeySource: "none"`. Haiku, `persistSession: false`. Several checks needed no model call: a streaming-input `query()` that never sends a Prompt still answers `initializationResult()`, `supportedCommands()` and `mcpServerStatus()`.
- **Codex:** `codex app-server` 0.160.1 over stdio, `CODEX_HOME` a fresh temp folder holding only a copy of an `auth.json` (ChatGPT Plus), `OPENAI_API_KEY`/`CODEX_API_KEY` stripped, `gpt-6-luna` at `effort: "low"`.
- **Fixtures:** a 15-line stdio MCP server with one tool (`secret_word`), an in-process SDK MCP server (`createSdkMcpServer`), and skill folders in four places: a Claude plugin folder, an `--add-dir` folder, a bare folder of skills, and the temp config folder.
- Nothing under `~/.claude` or `~/.codex` was written. `~/.claude.json`, `~/.codex/config.toml` and the skill folders were only listed to see their format.

---

## TL;DR

| Question | Claude (Agent SDK) | Codex (`app-server`) |
| --- | --- | --- |
| MCP servers per session | **Yes.** `mcpServers` on each `query()` (stdio, SSE, HTTP, in-process `sdk`), plus `setMcpServers()` mid-session. `strictMcpConfig: true` ignores every other source (verified live) | **Yes.** `config: { mcp_servers: {...} }` on `thread/start` (also `thread/resume`, `thread/fork`). The server exists only on that thread (verified live). Stdio and streamable HTTP only, no SSE or WebSocket (source) |
| MCP sign-in (OAuth) without a terminal | **No.** The SDK never runs an OAuth flow; a server needing it shows `needs-auth`. `claude mcp login` exits when stdin isn't a terminal (verified live). The app must do OAuth itself and pass `headers` | **Yes.** `mcpServer/oauth/login` returns an authorization URL with a `127.0.0.1` callback that app-server listens on, then sends `mcpServer/oauthLogin/completed` (verified live) |
| Read the user's MCP config | Possible, read-only: `~/.claude.json` (`mcpServers` at the top = user scope, `projects[path].mcpServers` = local scope). Same JSON shape as the SDK's `McpServerConfig` | Possible, read-only: `[mcp_servers.<name>]` tables in `~/.codex/config.toml` |
| Skills from an arbitrary folder | **Yes, three ways:** `plugins: [{ type: 'local', path }]`; skill folders (or symlinks) in the app's `CLAUDE_CONFIG_DIR/skills` with `settingSources: ['user']`; `additionalDirectories` with `settingSources: ['project']` (all verified live) | **Yes:** `skills/extraRoots/set` (app-server-wide) adds any folder; it even reads a Claude plugin's `skills/` folder (verified live) |
| Skills in a plain Tree | **Work.** The `Skill` tool injects the skill's text; no file tools needed (verified live) | **Don't work.** The model has to read `SKILL.md` with the shell, so with `environments: []` it can't, even when the skill is attached to the Prompt as a `skill` input (verified live) |
| Leaks past the isolated config folder | None found: the user's `~/.claude/skills` and `~/.agents/skills` were not loaded (verified live) | **`~/.agents/skills` is always read**, whatever `CODEX_HOME` is (verified live, source). MCP OAuth tokens in the OS keyring are keyed by server name and URL, not by `CODEX_HOME` (source) |
| Run in an Electron utility process | **Works:** spawn, stream, `interrupt()` (verified live in Electron 44.7.0) | **Works:** spawn, stream, `turn/interrupt` (verified live) |
| Children when the utility process dies | Exit (stdin closes), for both `child.kill()` and `SIGKILL` (verified live) | Same (verified live) |

---

## MCP servers

### Claude: per session, from the SDK

- **`mcpServers` on `query()`** takes `Record<string, McpServerConfig>`, where a config is stdio (`command`, `args`, `env`), `sse` or `http` (`url`, `headers`), or `sdk` (an in-process server created with `createSdkMcpServer`) [sdk.d.ts `McpServerConfig`]. Both kinds connected and their tools were called in one Turn: `mcp__echo__secret_word` and `mcp__inproc__house_color` (verified live). `canUseTool` fired for both MCP tools (verified live).
- **`strictMcpConfig: true`** uses only `mcpServers` (and servers declared in `agents`), ignoring `.mcp.json`, user settings, plugins and agent frontmatter [sdk.d.ts]. With it on, a server written into the app's own `CLAUDE_CONFIG_DIR/.claude.json` did not load; with it off and `settingSources: ['user']`, it loaded as scope `user` (verified live). So the app can either pass servers per session, or keep them in its own config folder. Per session is simpler and needs no files.
- **Changing servers mid-session:** `setMcpServers(servers)` replaces the dynamic set and reports `added`, `removed` and `errors` [sdk.d.ts]. Plugin-owned servers survive `setMcpServers({})`, so if we load plugins for skills, use `skipMcpDiscovery: true` on them [sdk.d.ts `SdkPluginConfig`].
- **Status:** `mcpServerStatus()` gives `connected | failed | needs-auth | pending | disabled` per server [sdk.d.ts]. Servers connect in the background: the stdio server was `pending` straight after init and `connected` 3 s later (verified live). `alwaysLoad: true` makes startup wait for it (up to 5 s) [sdk.d.ts].
- **Prewarming:** `mcpServers`, `skills` and plugins are fixed when a spare process is prewarmed, so a spare is only reusable for sessions with the same set [sdk.d.ts `prewarm`].

**OAuth for remote servers:** "The SDK doesn't open a browser or run an interactive OAuth flow. When a configured server returns an authorization challenge and no stored token is available, the agent run continues without that server's tools, and the server reports status `needs-auth`." The documented fix is to "complete the OAuth flow in your own application and pass the resulting access token in the server's `headers`" ([Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp.md#oauth2-authentication)). `claude mcp login <name>` exists, but with stdin not a terminal it printed the authorization URL, then "stdin isn't a terminal, so authentication can't be completed here", and exited within 10 s (verified live, against `https://mcp.sentry.dev/mcp` added with `claude mcp add --scope user` into the temp config folder). Claude Code keeps MCP OAuth tokens with its own credentials, so tokens from the user's `~/.claude` never reach the app's config folder.

### Codex: per thread, through config overrides

- **`thread/start`, `thread/resume` and `thread/fork` take `config`**, a map of config keys (source: `app-server-protocol/src/protocol/v2/thread.rs:100, 410, 604`). `turn/start` does not. Passing `config: { mcp_servers: { echo: { command, args, env } } }` gave that thread the `echo` server, and the model called it (`mcpToolCall` item, `status: "completed"`). A second thread without the override, and `mcpServerStatus/list` without a `threadId`, did not list it (all verified live).
- **Transports:** `McpServerTransportConfig` has only `Stdio` and `StreamableHttp` (source: `config/src/mcp_types.rs:625-660`). HTTP auth fields are `bearer_token_env_var`, `http_headers`, `env_http_headers` and `http_headers_helper`; an inline `bearer_token` is rejected (source: `config/src/mcp_types.rs:395-529`). Other per-server keys: `enabled`, `required`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec`, `tool_timeout_sec`, `default_tools_approval_mode`, `scopes`, `oauth`.
- **Stdio servers get a trimmed environment:** only `HOME, LOGNAME, PATH, SHELL, USER, LANG, LC_ALL, TERM, TMPDIR, TZ` (and a few more) plus the server's own `env` / `env_vars` (source: `rmcp-client/src/utils.rs:16-175`).
- **Status and reloads:** `mcpServerStatus/list` (optionally per `threadId` and `serverName`) returns tools, resources, `authStatus` and `runtimeStatus`; `mcpServer/startupStatus/updated` notifications report `starting` / `ready` / `failed`; `config/mcpServer/reload` re-reads config (source: `app-server-protocol/src/protocol/common.rs:1221-1260, 1979`).
- **The account's connectors are always there:** every thread also had `codex_apps` (ChatGPT's own connectors: sites, pets, plugin management, `search_service.web_run`…), with `authStatus: "bearerToken"` (verified live). This matches #31's finding; turning it off is a Capability tiers matter, not an MCP one.

**OAuth for remote servers works without a terminal.** With a per-thread HTTP server pointing at `https://mcp.sentry.dev/mcp`, the thread reported `authStatus: "notLoggedIn"` and `runtimeStatus: "authenticationRequired"`. `mcpServer/oauth/login { name, threadId, timeoutSecs }` returned an `authorizationUrl` on `mcp.sentry.dev` with `redirect_uri=http://127.0.0.1:<port>/callback` and Codex's own client id. After the timeout, `mcpServer/oauthLogin/completed` arrived with `success: false, "timed out waiting for OAuth callback"` (verified live; the sign-in itself wasn't completed). So the app opens the URL in the browser and waits for the notification.

**Token storage leaks across homes:** MCP OAuth tokens go to the OS keyring under service `Codex MCP Credentials`, with a key built from the server name and a hash of `{type, url, headers}`. `CODEX_HOME` is part of the key only for enterprise servers (`ema-idp:` names), "because the OS keyring is shared across homes". The file fallback is `CODEX_HOME/.credentials.json` (source: `rmcp-client/src/oauth.rs:1-20, 93, 1016-1043`). So if the user already signed in to a server in their own Codex, under the same name and URL, the app's Codex would find and refresh the same keyring entry (from the source; not tested). Setting `mcp_oauth_credentials_store = "file"` in the app's `config.toml` keeps tokens in the app's folder (source: `config/src/config_toml.rs:306`).

### Reading and translating the user's existing config

Both are plain files, so a read-only import is easy. Where they live:

| Provider | User-wide | Per project | Other sources (not importable as files) |
| --- | --- | --- | --- |
| Claude | `~/.claude.json` top-level `mcpServers` ("user scope") | `~/.claude.json` → `projects["/abs/path"].mcpServers` ("local scope"); `<project>/.mcp.json` ("project scope") | Plugins' servers; managed MCP; claude.ai connectors (come with the account) ([Claude Code MCP](https://code.claude.com/docs/en/mcp.md#mcp-installation-scopes)) |
| Codex | `~/.codex/config.toml` `[mcp_servers.<name>]` | `.codex/config.toml` in a trusted project | Plugins; `codex_apps` (account connectors) |

On this machine `~/.claude.json` had one user-scope stdio server and no local-scope servers, and `~/.codex/config.toml` had none. Both are the shapes above.

**Field mapping** (Claude fields from [Claude Code MCP](https://code.claude.com/docs/en/mcp.md) and [sdk.d.ts], Codex fields from `config/src/mcp_types.rs`):

| Claude JSON | Codex TOML | Notes |
| --- | --- | --- |
| `type: "stdio"` (or omitted), `command`, `args`, `env` | `command`, `args`, `env` | Direct |
| `type: "http"` / `"streamable-http"`, `url`, `headers` | `url`, `http_headers` | Direct |
| `type: "sse"` | none | Codex has no SSE: skip on Codex |
| `type: "ws"`, `headersHelper` | none / `http_headers_helper` | `ws` isn't in the SDK's types either; the SDK's types also lack `headersHelper`. Skip `ws`, test `headersHelper` if anyone needs it |
| `oauth: { clientId, callbackPort }` | `oauth`, `scopes` | Sign-in must be redone in the app either way |
| `${VAR}` / `${VAR:-default}` expansion | `env_vars`, `bearer_token_env_var`, `env_http_headers` | The app should expand `${VAR}` itself when importing to Claude, or keep the reference |
| `type: "sdk"` | none | Only an SDK host can register one; never in user config |

**Gotchas for an import:**

- **Sign-ins don't come along.** Claude's tokens sit with the user's Claude credentials, and Codex's are keyed in the keyring (see above). Remote OAuth servers have to be signed in to again inside the app: through `mcpServer/oauth/login` on Codex, and through our own OAuth code on Claude.
- **`PATH`:** most stdio servers start with `npx`, `uvx`, `docker` or similar. A Mac app opened from Finder gets launchd's minimal `PATH`, not the user's shell `PATH` (a well-known macOS behaviour; not tested here). Codex passes `PATH` to MCP servers from its own environment (source: `rmcp-client/src/utils.rs:163`). The app needs to resolve the user's login-shell `PATH` once and hand it to both vendor programs, or the imported servers fail to start.
- **Secrets:** imported `env` and `headers` often hold API tokens in plain text. Whatever the app stores is a secret, which collides with the "the app keeps no secrets of its own" rule from Distribution and update strategy ([#13](https://github.com/qodesmith/unimatrix-zero/issues/13)). Re-reading the user's files at session start, instead of copying them, avoids storing them.

---

## Skills

Both Providers use the same `SKILL.md` format (a folder holding `SKILL.md` with `name` and `description` frontmatter), so one skill folder works on both. Codex even named a skill inside a Claude plugin folder `uzplug:plugskill`, as Claude does (verified live).

### Claude

Skills are files; "the SDK doesn't provide a programmatic API for registering them" ([Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills.md)). Ways to load them from a folder we choose (all verified live, with `CLAUDE_CONFIG_DIR` set to a temp folder):

| Way | Result |
| --- | --- |
| `plugins: [{ type: 'local', path: '/any/folder' }]` (needs `.claude-plugin/plugin.json` and `skills/<name>/SKILL.md`) | Loaded with `settingSources: []`, named `plugin:skill` (`uzplug:plugskill`). The model invoked it with the `Skill` tool and got its text |
| Skill folders in `$CLAUDE_CONFIG_DIR/skills/` with `settingSources: ['user']` | Loaded (`cfgskill`). A **symlinked** skill folder loaded too (`freeskill`) |
| `additionalDirectories: ['/x']` with `settingSources: ['project']` | Loaded `/x/.claude/skills/*` (`adddirskill`) |
| `settingSources: []`, no plugins | None of the above |

- **No leak from the user's own folders:** with `CLAUDE_CONFIG_DIR` set, none of the user's `~/.claude/skills` skills and not `~/.agents/skills` showed up in any variant (verified live).
- **Bundled skills** (`deep-research`, `design`, `dataviz`, `verify`, `debug`, `code-review`, `simplify`, `batch`, `loop`, `claude-api`, …) are always listed. `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` (or `disableBundledSkills`) removes them [sdk.d.ts]. The `skills` option is a filter: `'all'`, a list of names, or `[]`; unlisted skills are hidden from the model and refused by the `Skill` tool [sdk.d.ts]. Note that `/name` in a Prompt runs a user-invocable skill even if it isn't in the list ([Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills.md#dispatch-commands-by-name)).
- **Plain Trees:** `tools: ['Skill']` was enough. The skill's instructions came back through the tool, with no `Read` or `Bash` (verified live).
- **claude.ai skills:** when signed in with a claude.ai account, Claude Code downloads the skills enabled on the account into `<config>/skills/synced/` and loads them in every session; `syncClaudeAiSkills: false` turns this off ([Claude Code skills](https://code.claude.com/docs/en/skills.md#how-synced-skills-behave), [sdk.d.ts]). With the env-token login used here nothing was synced, so whether the app's real sign-in pulls them in was not tested. They behave like account connectors, so they should follow the same default.

### Codex

Skill roots come from the config layers plus app-supplied roots (source: `ext/skills/src/host_roots.rs:27-130`):

| Root | Scope | Follows `CODEX_HOME`? |
| --- | --- | --- |
| `$CODEX_HOME/skills` (deprecated location) | user | yes |
| **`$HOME/.agents/skills`** | user | **no**, it uses the home folder |
| `$CODEX_HOME/skills/.system` (bundled: `imagegen`, `openai-docs`, `review-agent`, `skill-creator`, `skill-installer`) | system | yes |
| `/etc/codex/skills` | admin | n/a |
| `.codex/skills` and `.agents/skills` in each folder from the project root to `cwd` | repo | n/a |
| Plugin skills | plugin | yes |
| **`skills/extraRoots/set { extraRoots }`** | user | n/a, set by the app |

- **Extra roots work:** after `skills/extraRoots/set` with a bare folder and a Claude plugin's `skills/` folder, `skills/list` showed `freeskill` and `uzplug:plugskill` (verified live). The setting is app-server-wide, not per thread (source: `app-server/src/request_processors/catalog_processor.rs:595-604`); per-thread choices go through `skills.config` rules in the thread's `config`.
- **`~/.agents/skills` leaks in:** with a fresh `CODEX_HOME`, `skills/list` showed the user's `~/.agents/skills/agent-browser` (verified live). Setting `HOME` to another folder for the Codex process hid it (verified live), but `HOME` also affects every command Codex runs in a Workspace. A cleaner off switch is a path rule in the app's `config.toml`, `[[skills.config]] path = ".../SKILL.md", enabled = false`, which marked it disabled (verified live). Turning a whole root off isn't possible; rules are per skill (source: `config/src/skills_config.rs`). `skills.bundled.enabled = false` drops the bundled ones (source).
- **Plain Trees:** with `environments: []`, the model said "I can't read the freeskill file with the available tools", even when the Prompt carried a `{ type: "skill", name, path }` input. With the default environment it ran `cat …/SKILL.md` and answered correctly (both verified live). So on Codex, skills need a Workspace (or at least a read-only environment).

---

## Process placement

### Spike: both drivers in one Electron utility process (verified live)

Electron 44.7.0 on macOS arm64. `main.mjs` called `utilityProcess.fork('driver.mjs', [], { stdio: 'pipe', serviceName })` after `ready`. The driver (an ES module) imported the Agent SDK, spawned `codex app-server`, and sent events back with `process.parentPort.postMessage`. Results:

- The utility process runs Node inside `Electron Helper.app` (`process.type === 'utility'`). `child_process.spawn` of both vendor binaries worked.
- **Codex:** `initialize` → `thread/start` → `turn/start`. Deltas streamed (`item/agentMessage/delta`), `turn/interrupt` after the 5th delta returned `{}`, and the turn ended `interrupted`.
- **Claude:** `query()` with `includePartialMessages` streamed `stream_event` deltas (the first was a `thinking_delta`). `interrupt()` after the 5th delta worked, the result was `error_during_execution`, and **the for-await loop then threw** ("Claude Code returned an error result"). That is the documented single-Prompt behaviour; a driver that wants to continue after Stop should use streaming-input mode, as #23 assumed.
- The driver used `spawnClaudeCodeProcess` to spawn `claude` itself and learn its pid. It works unchanged in a utility process.
- **Teardown:** with a live `codex app-server` and a live, idle Claude session, `child.kill()` (SIGTERM) and, in a second run, `SIGKILL` of the utility process both left **no** surviving vendor processes 3 s later. They exit when their stdin pipe closes. Their own children (MCP servers, shell commands) weren't checked.

### What Electron's docs say

From [`utility-process.md` v44.7.0](https://github.com/electron/electron/blob/v44.7.0/docs/api/utility-process.md):

- It's "the equivalent of `child_process.fork`", launched through Chromium's Services API, with Node and message ports. It can be created only after `app` is `ready`.
- `stdin` can't be piped (only `stdout`/`stderr`); talk to it with `postMessage` / `MessagePortMain`. A `MessagePortMain` can be passed to a renderer, so streamed events can go straight to the window without going through main.
- `serviceName` shows in `app.getAppMetrics()` and `child-process-gone`, so a crash is observable and the app can restart it.
- `disclaim` (macOS, default `false`): when false, macOS privacy (TCC) prompts from the utility process and its children are attributed to the app. That's what we want, so a Workspace's folder grants stay with the app (ADR 0007's reason for keeping the app bundle stable).
- Network: the utility process uses the system network context; proxy and auth (`respondToAuthRequestsFromMainProcess`) differ from main. This matters little here, because the vendor programs make their own network calls.

### Known problems (electron/electron issues)

- [#47228](https://github.com/electron/electron/issues/47228) (open): a utility process doesn't exit when it runs out of work. That doesn't matter for a long-lived driver host, but shutdown has to call `process.exit()` or `kill()`.
- [#53923](https://github.com/electron/electron/issues/53923) (closed 2026-09): the main process crashed when `postMessage()` was called inside the child's `exit` listener. Don't message a dead child.
- [#41396](https://github.com/electron/electron/issues/41396), [#42978](https://github.com/electron/electron/issues/42978), [#29125](https://github.com/electron/electron/issues/29125) (closed): crashes and instant exits with asar paths in packaged apps. Fixed, but packaged-app forking is worth a smoke test in CI.
- [#49455](https://github.com/electron/electron/issues/49455) (closed 2026-03): wrong `exit` code on Windows. Don't rely on exit codes alone.
- Nothing open about spawning children, streaming or killing from a utility process.

### Main process versus utility process

Both work; nothing forces the main process. The trade-offs:

| | Main process | One utility process for both drivers |
| --- | --- | --- |
| Crash in SDK/driver code | Takes the whole app down | Only the drivers; vendor children die with it (verified), in-flight Replies fail, the app restarts it |
| CPU (JSON parsing of every delta, SDK bookkeeping) | Shares the loop that serves IPC for every window | Off the main loop |
| Streaming to the UI | `webContents.send` | `MessagePortMain` straight to the renderer, plus a channel to main for saving |
| Database writes ([#11](https://github.com/qodesmith/unimatrix-zero/issues/11): database in main) | Direct | Every saved event crosses one more hop to main |
| `canUseTool` / approvals | UI → main → callback | UI → (main →) utility → callback; one more hop, still async |
| In-process SDK MCP servers | In main | In the utility process |
| Precedent | ADR 0005 / #12 assumed main | T3 Code runs its provider code in a separate Node process (`ELECTRON_RUN_AS_NODE`), see [AI library landscape](https://github.com/qodesmith/unimatrix-zero/blob/research/ai-library-landscape/docs/research/ai-library-landscape.md) |

**Recommendation for #38:** one long-lived utility process ("Provider host") running both drivers, restarted on `child-process-gone`, with a `MessagePortMain` to each window for streaming and a port to main for saving Turns. It costs one extra hop for saving and approvals, and buys crash and CPU isolation at no feature cost. Keeping the drivers in main is an acceptable fallback, since nothing tested depends on the choice.

---

## Implications for Provider drivers, process model and IPC event list (#38)

- **MCP: both Providers can take servers per session with no files**, so "the app's own MCP list, passed per session" is the natural model. A read-only import from `~/.claude.json` and `~/.codex/config.toml` is easy (the table above). Sign-ins don't transfer, and SSE servers can't go to Codex.
- **MCP sign-in is lopsided.** Codex has a terminal-free OAuth flow (`mcpServer/oauth/login`). Claude has none, so the app would need its own MCP OAuth client (discovery, dynamic registration, PKCE, loopback callback, refresh) and pass tokens as `headers`, storing them, which runs into the no-secrets rule. Or v1 supports OAuth servers on ChatGPT only, and header/env-token servers on both.
- **Skills: one app-owned skills folder can feed both Providers** (Claude through `plugins` or a symlinked `CLAUDE_CONFIG_DIR/skills`, Codex through `skills/extraRoots/set`), whether it holds imported copies, symlinks to the user's folders, or skills added in the app.
- **Codex reads `~/.agents/skills` regardless.** Decide whether that's welcome (it's the user's own skills, which #9 allows) or must be switched off per skill with `[[skills.config]]` rules.
- **Skills don't work in Codex plain Trees** (no environment to read `SKILL.md`), but do on Claude. The Tools panel has to say so, or plain Codex Trees need a read-only environment.
- **Use `strictMcpConfig: true`, `skipMcpDiscovery: true` on plugins, `mcp_oauth_credentials_store = "file"` on Codex, and a login-shell `PATH`** for imported stdio servers.

## Not verified / open

- Completing an OAuth sign-in end to end (Codex) and whether the shared keyring entry is reused or rotated across homes.
- claude.ai synced skills and connectors under the app's real Claude sign-in (here it was an env token).
- Whether a Claude plugin whose `skills/` folder is itself a symlink loads (a plugin built that way did not show its skill, possibly deduplicated against the same real path; symlinking each skill folder works).
- Grandchildren (MCP servers, Workspace commands) when the utility process dies; Windows and Linux behaviour of the spike.
- `headersHelper` / `http_headers_helper` for imported servers.
