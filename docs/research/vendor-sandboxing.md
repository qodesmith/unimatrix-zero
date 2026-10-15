# Vendor sandboxing for commands the AI runs

Research for [#49](https://github.com/qodesmith/unimatrix-zero/issues/49) (grilling ticket), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-10-15. **No live tests**; everything here was read in source, types or official docs.

**Question:** Are the vendor programs' OS-level sandboxes on, and how, for commands the AI runs? What can a sandboxed command read, reach on the network, and how does the model escape the sandbox?

**Sources checked:**

- Claude Agent SDK `@anthropic-ai/claude-agent-sdk@0.3.300` (`sdk.d.ts`, `sdk-tools.d.ts`, `sdk.mjs`), bundling Claude Code **2.1.300** (`manifest.json:2`). Installed fresh from npm into a temp folder.
- `@anthropic-ai/sandbox-runtime` 0.0.79 (SRT), the open-source runtime Claude Code's sandbox is built on: `anthropic-experimental/sandbox-runtime@9a277e5` (`README.md`, `src/sandbox/*.ts`).
- Claude Code docs: [sandboxing](https://code.claude.com/docs/en/sandboxing), [SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), [SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions).
- Codex `openai/codex` at `main@3bae578` (2026-10-15). The workspace version is a `0.0.0` placeholder stamped at release, so this is "current main", not a numbered release. Paths below are relative to `codex-rs/`.
- Codex docs: [sandboxing](https://learn.chatgpt.com/docs/sandboxing), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security), [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox). Every `developers.openai.com/codex/*` URL now redirects there, and the in-repo `docs/sandbox.md` and `docs/config.md` are pointer stubs.

**Already covered elsewhere, not redone:** Codex sandbox and approval enum values and `/tmp` defaults ([workspaces-mechanics](https://github.com/qodesmith/unimatrix-zero/blob/research/workspaces-mechanics/docs/research/workspaces-mechanics.md) section 5), Codex children inheriting the parent's sandbox ([subagents](https://github.com/qodesmith/unimatrix-zero/blob/research/subagents/docs/research/subagents.md)), the SDK `sandbox` option's existence ([subscription-session-capabilities](https://github.com/qodesmith/unimatrix-zero/blob/research/subscription-session-capabilities/docs/research/subscription-session-capabilities.md)).

**Confidence labels:** **(source)** read in source or type definitions; **(docs)** official docs only; **(inferred)** follows from the above but not traced end to end.

## Short answer

| | Claude (Agent SDK) | Codex (app-server) |
| --- | --- | --- |
| Sandbox on by default? | **No.** `sandbox.enabled` defaults to `false` | **Yes** on macOS and Linux: `read-only` and `workspace-write` are always enforced by Seatbelt or bwrap+seccomp |
| How the app turns it on | `Options.sandbox: { enabled: true, ... }`; works with `settingSources: []` because it rides the `--settings` layer | `thread/start { sandbox: "read-only" \| "workspace-write" }` or `turn/start { sandboxPolicy }`; writable roots and network come from `config.toml` |
| Covers | **Bash only** (plus child processes). Read/Edit/Write/Glob/Grep, WebFetch, MCP servers and hooks run outside | The model's shell and `apply_patch` only. MCP servers and hosted web search run outside |
| Reads | Default: whole disk incl. `~/.ssh`. `filesystem.denyRead` / `credentials.files` hide paths from Bash; `Read(...)` deny rules hide them from the Read tool and are also merged into `denyRead` | **Whole disk, always**, incl. `~/.ssh`, `~/.aws`, `auth.json`. A deny-read list exists only in opt-in named `[permissions.<name>]` profiles |
| Network | **Default deny**, domain allowlist through a local proxy. Unknown hosts prompt (or are refused with `strictAllowlist`) | Boolean per mode (`network_access`). A separate opt-in `[features.network_proxy]` adds a domain allow/deny list |
| Escape hatch | Model sets `dangerouslyDisableSandbox: true` on Bash; reaches `canUseTool`. **`allowUnsandboxedCommands: false` removes it entirely** | Model sets `sandbox_permissions: "require_escalated"` → `item/commandExecution/requestApproval`; host answers `decline`. `approval_policy: "never"` fails closed |
| Linux without bwrap | `failIfUnavailable` (defaults to **true** via the SDK option) → `query()` fails at startup. `false` → warns and runs **unsandboxed** | **Codex ships its own `bwrap`** in `codex-resources/`, so there is nothing to install; needs unprivileged user namespaces |
| Windows | **Unsandboxed** natively; WSL2 only | Three native backends (`[windows] sandbox = "elevated" \| "unelevated" \| "mxc"`), **off by default**. Off → `workspace-write` silently becomes `read-only` and commands run **unsandboxed** |
| Subagents | Same process, same sandbox | Same policy (prior research) |

---

## Claude

### 1. The `Options.sandbox` type, and whether it is the only switch

`Options.sandbox?: SandboxSettings` (`sdk.d.ts:2215`) **(source)**. The inferred shape of the zod schema (`sdk.d.ts:3491-3590`), with the documented keys on `Settings.sandbox` (`sdk.d.ts:8763-8985`):

```ts
sandbox?: {
  enabled?: boolean;                  // Default: false
  failIfUnavailable?: boolean;        // CLI default false; the SDK option flips it to true (below)
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean; // Default: true
  network?: {
    allowedDomains?: string[]; deniedDomains?: string[];
    strictAllowlist?: boolean; allowManagedDomainsOnly?: boolean;
    allowUnixSockets?: string[]; allowAllUnixSockets?: boolean;
    allowLocalBinding?: boolean; allowMachLookup?: string[];
    httpProxyPort?: number; socksProxyPort?: number;
    tlsTerminate?: { caCertPath?: string; caKeyPath?: string };
  };
  filesystem?: {
    allowWrite?: string[]; denyWrite?: string[];
    denyRead?: string[]; allowRead?: string[];
    allowManagedReadPathsOnly?: boolean; disabled?: boolean;
  };
  credentials?: { files?: { path: string; mode: 'deny' | 'mask' }[]; envVars?: ...; awsPairs?: ...; sigv4?: ...; allowPlaintextInject?: boolean };
  ignoreViolations?: Record<string, string[]>;
  enableWeakerNestedSandbox?: boolean;    // Linux: skip fresh /proc, "Reduces security"
  enableWeakerNetworkIsolation?: boolean;
  allowAppleEvents?: boolean;
  excludedCommands?: string[];            // "A convenience, not a security boundary"
  ripgrep?: { command: string; args?: string[] };
  bwrapPath?: string; socatPath?: string;
}
```

The published SDK docs show a shorter type (no `credentials`, `tlsTerminate`, `allowAppleEvents`): the package is ahead of the docs **(docs)**.

- **Plumbing (source):** `sdk.mjs` merges `Options.sandbox` into the inline `--settings` layer (it throws `Cannot use both a settings file path and the sandbox option`), and **sets `failIfUnavailable = true` when `enabled === true` and nothing else set it** (`sdk.mjs`: `if(t.enabled===!0&&s.failIfUnavailable===void 0)s.failIfUnavailable=!0`; docblock `sdk.d.ts:2169-2175`).
- **With `settingSources: []` the option still applies**, because `settingSources` controls only the user/project/local file sources (`sdk.d.ts:2273`); the `--settings` layer is not one of them **(source)**. Two equivalents also work: `Options.settings` as an inline object (`sdk.d.ts:2216-2233`) and `Options.managedSettings`, a restrictive-only policy tier (`sdk.d.ts:2234-2262`, `3354-3360`).
- **No env var or CLI flag enables it.** The only `SANDBOX` env names in `sdk.mjs` are markers and tuning (`CLAUDE_CODE_SANDBOXED`, `IS_SANDBOX`, `CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR`, ...); docs name only `/sandbox` and `sandbox.enabled` **(source for the grep, docs for the rest)**.

### 2. What the sandbox covers, and what hides `~/.ssh`

- **Shell commands only.** Docs: "The sandbox covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it", and explicitly "A `denyRead` entry doesn't stop the Read tool, and `allowedDomains` doesn't limit WebFetch" ([sandboxing](https://code.claude.com/docs/en/sandboxing), "What runs outside the sandbox") **(docs)**. The type agrees: `strictAllowlist` is "Enforced for sandboxed commands only — in-process tools such as WebFetch are not gated" (`sdk.d.ts:8787`) **(source)**.
- **Default reads are the whole machine.** The docs' table lists the default read scope as "Most of the machine, including credential files such as `~/.ssh` and `~/.aws/credentials`" **(docs)**. So the deny list must be supplied.
- **`denyRead` does hide paths from Bash:** SRT's README demonstrates `cat ~/.ssh/id_rsa` → `Operation not permitted` (`README.md:34-36`) **(source)**. `credentials.files: [{ path, mode: 'deny' | 'mask' }]` is the newer form; `mask` degrades to `deny` on macOS and Windows (`sdk.d.ts:8854-8862`).
- **Symlinks:** on Linux deny paths are canonicalised before masking (`src/sandbox/linux-sandbox-utils.ts:157-195`) and the README's "Read-side rules (Linux)" says denies match a path "by the name it is, not by what it points at", with glob expansion denying symlink targets "where it really is". On macOS the profile denies `file-write-unlink`/`file-write-create` on protected ancestors so a path can't be swapped for "an attacker-controlled symlink" (`src/sandbox/macos-sandbox-utils.ts:810-815`) **(source)**.
- **Stopping the Read tool**, all usable with `settingSources: []`:
  - `disallowedTools: ['Read(//Users/me/.ssh/**)']`: scoped entries become deny rules; `//` anchors to the filesystem root ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions), "Allow and deny rules") **(docs)**. `Edit(...)` deny rules also govern Write and NotebookEdit.
  - Or inline `settings: { permissions: { deny: [...] } }` (`sdk.d.ts:6919-6925`) **(source)**.
  - **`Read(...)` deny rules are merged into `sandbox.filesystem.denyRead`** (`sdk.d.ts:8836`), so one rule set covers both the Read tool and Bash **(source)**.
  - `permissions.blockReadsOutsideWorkingDirectories?: boolean` (`sdk.d.ts:6943`) is the blunt version **(source)**.
  - **`canUseTool` is not enough on its own:** deny rules resolve before it, and reads inside the working directories are auto-approved and never reach it (`sdk.d.ts:5592`; permissions docs, "Auto-approved tools never reach `canUseTool`") **(source)**.

### 3. Platforms and missing dependencies

- **macOS:** `sandbox-exec` with a generated Seatbelt profile starting `(deny default)` (`macos-sandbox-utils.ts:1084-1086`); no extra dependencies **(source)**.
- **Linux and WSL2:** needs `bubblewrap` (`bwrap`, ≥ 0.4.0) and `socat`; SRT's `checkLinuxDependencies` reports `bubblewrap (bwrap) not installed` and `socat not installed` as **errors**, and a missing seccomp helper as only a warning (`seccomp not available - unix socket access not restricted`) (`src/sandbox/sandbox-manager.ts:1294-1309`, `linux-sandbox-utils.ts`). WSL1 is unsupported (`sandbox-manager.ts:1261-1267`). Ubuntu 24.04 needs its AppArmor user-namespace restriction handled (`README.md:694-700`). Claude Code bundles ripgrep **(docs)**. `enableWeakerNestedSandbox` skips the fresh `/proc` mount for unprivileged Docker and "Reduces security" (`sdk.d.ts:8969`) **(source)**.
- **Windows:** SRT has an alpha native backend (separate `srt-sandbox` user, WFP, ACLs, one-time elevated install; `README.md:734-810`), but **Claude Code does not use it**: "On native Windows, Claude Code runs commands unsandboxed. To use the sandbox on a Windows machine, run Claude Code inside a WSL2 distribution" ([sandboxing](https://code.claude.com/docs/en/sandboxing)) **(docs)**.
- **When bwrap is missing:** SRT `initialize()` throws `Sandbox dependencies not available: ...` (`sandbox-manager.ts:912-918`). Claude Code's response depends on `failIfUnavailable`: `false` → "a warning is shown and commands run unsandboxed"; `true` → "Exit with an error at startup" (`sdk.d.ts:8769`). **Through the SDK option the default is `true`** (section 1), so `query()` ends with a `result` of `subtype: "error_during_execution"` ([SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), "Sandbox Configuration"). It is a **per-session** gate, decided at startup, not per command **(source)**.

### 4. Network

- **Default deny.** SRT: "By default, all network access is denied... An empty allowedDomains list means no network access" (`README.md:122`). Claude Code: connections go through a proxy on the machine that checks each host against the allowed domains, "which start empty"; an unknown host **prompts** in default/`acceptEdits`, is **allowed silently in `bypassPermissions`**, and is refused in `dontAsk`/auto mode. `strictAllowlist: true` makes a miss a deterministic deny (`sdk.d.ts:8787`) **(source + docs)**.
- **Mechanism:** a host-side HTTP proxy and SOCKS5 proxy. Linux: `bwrap --unshare-net`, with `socat` bridging Unix sockets to fixed in-namespace ports 3128/1080 (`linux-sandbox-utils.ts:1461-1471, 1778-1780`). macOS: Seatbelt allows outbound only to `localhost:<httpProxyPort>` and `<socksProxyPort>` (`macos-sandbox-utils.ts:1320-1345`). Tools find the proxy through `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`; tools that ignore those (plain `ssh`, most DB drivers, UDP/QUIC) cannot connect at all **(source + docs)**.
- **Hostname filtering at CONNECT, no TLS interception by default:** "the built-in proxy enforces the allowlist based on the requested hostname and, by default, does not terminate or inspect TLS traffic" (docs; `src/sandbox/http-proxy.ts:104-118` calls CONNECT "an opaque byte tunnel" unless a MITM CA is set). `network.tlsTerminate` is the experimental opt-in. Since 2.1.284 an allowed name that resolves to loopback or link-local is refused **(source + docs)**.
- **`git push` over SSH:** SRT sets `GIT_SSH_COMMAND` with a `ProxyCommand` that opens an HTTP CONNECT through the proxy, gated by `allowedDomains` (`README.md`, "git over SSH"). Docs: **works on Linux/WSL2 once the host is allowed; fails on macOS** ("the macOS tunnel can't authenticate to that proxy"); workarounds are an HTTPS remote or `excludedCommands: ["git fetch *", "git pull *", "git push *"]`. The key must be readable as a file: "the sandbox can block the `ssh-agent` socket, and a `denyRead` or `credentials` entry for `~/.ssh` hides your key files". Plain `ssh`/`scp`/`rsync` fail **(docs; mechanism in source)**.
- **`allowUnixSockets`:** Unix sockets are blocked by default on both platforms. macOS: each entry emits `(allow system-socket (socket-domain AF_UNIX))` plus bind/outbound on `(subpath <path>)` (`macos-sandbox-utils.ts:1295-1318`). **Linux ignores it**: seccomp blocks `socket(AF_UNIX)` outright and cannot filter by path, so only `allowAllUnixSockets` opens them (`sdk.d.ts:8795-8799`); SRT warns `/var/run/docker.sock` is a full escape **(source)**.
- **`allowLocalBinding`** is macOS only (`sdk.d.ts:8803`); on Linux each command gets a private loopback, so a dev server started by one command isn't reachable by the next **(source + docs)**. **`httpProxyPort`/`socksProxyPort`** mean "bring your own proxy", and the allow/deny lists then stop applying to that traffic (`sdk.d.ts:8811-8815`).

### 5. The escape hatch

- **Model-side flag:** `BashInput.dangerouslyDisableSandbox?: boolean`, "Set this to true to dangerously override sandbox mode and run commands without sandboxing" (`sdk-tools.d.ts:843-846`); echoed on the Bash output (`:3323-3326`). Only Bash carries it **(source)**. When a sandboxed command is blocked, the result names what was blocked and the model "may retry the command with the `dangerouslyDisableSandbox` parameter" ([sandboxing](https://code.claude.com/docs/en/sandboxing), "The unsandboxed retry escape hatch") **(docs)**.
- **In the SDK:** the retry "falls back to the existing permissions system, meaning your `canUseTool` handler is invoked"; the docs' example checks `tool === "Bash" && input.dangerouslyDisableSandbox` ([SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), "Permissions Fallback for Unsandboxed Commands"). `PermissionResult` has **no** sandbox field (`sdk.d.ts:2528-2540`); the wire-level `decision_reason_type` includes `'sandboxOverride'` (`sdk.d.ts:4853`) but `canUseTool`'s options expose only a free-text `decisionReason` (`sdk.d.ts:250`). Detect it from `input.dangerouslyDisableSandbox` **(source)**. **Caveat:** a matching `Bash(...)` allow rule, `bypassPermissions`, or `autoAllowBashIfSandboxed` can approve the retry without the callback; docs warn this "effectively allows the model to escape sandbox isolation silently" **(docs)**.
- **Host can refuse entirely:** `allowUnsandboxedCommands: false`: "the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed. Default: true" (`sdk.d.ts:8774-8776`). With `failIfUnavailable: true` nothing ever runs unsandboxed (docs, "Turn off the retry with strict sandbox mode"). Setting it through `--settings`/`Options.sandbox` also makes the sandbox "admin-required": loosening keys in a linked folder's `.claude/settings*.json` are ignored (`sdk.d.ts:8765-8981` docblocks; docs, ≥ 2.1.285) **(source)**. `excludedCommands` stays as the only exit, and "excluded commands still go through the permission flow" (`sdk.d.ts:8981`).

### 6. Subagents

"Subagents run in the same process as the parent session and use the same sandbox configuration. Bash commands inside a subagent are sandboxed when sandboxing is enabled in the parent session" ([sandboxing](https://code.claude.com/docs/en/sandboxing), "Scope") **(docs)**. `AgentDefinition` has no sandbox field (`sdk.d.ts:38-100`), and the Agent tool's `isolation: "worktree" | "remote"` is git/cloud isolation, not the OS sandbox (`sdk-tools.d.ts:812-815`) **(source)**.

---

## Codex

### 7. `sandbox_mode`, `[sandbox_workspace_write]`, and per-thread sandbox

- **Config (source):** `sandbox_mode: Option<SandboxMode>` and `sandbox_workspace_write: Option<SandboxWorkspaceWrite>` (`config/src/config_toml.rs:224, 234`); the struct (`config/src/types.rs:1184-1195`):

  ```rust
  pub struct SandboxWorkspaceWrite {
      pub writable_roots: Vec<AbsolutePathBuf>,
      pub network_access: bool,
      pub exclude_tmpdir_env_var: bool,
      pub exclude_slash_tmp: bool,
  }
  ```

  Values `read-only | workspace-write | danger-full-access` (docs agree). A newer alternative is `default_permissions` plus named `[permissions.<name>]` profiles (`config/src/permissions_toml.rs:23`); docs say not to combine the two **(docs)**.
- **Core policy (source):** `SandboxPolicy` is tagged `type`, kebab-case: `danger-full-access`, `read-only { network_access }`, `external-sandbox { network_access }`, `workspace-write { writable_roots, network_access, exclude_tmpdir_env_var, exclude_slash_tmp }` (`protocol/src/protocol.rs:1178-1229`). Default writable roots: cwd, `/tmp` unless excluded, `$TMPDIR` unless excluded (`:1356-1420`).
- **`thread/start` takes a mode, not a policy (source)** (`app-server-protocol/src/protocol/v2/thread.rs:88-98`):

  ```rust
  pub approval_policy: Option<AskForApproval>,
  pub approvals_reviewer: Option<ApprovalsReviewer>,
  pub sandbox: Option<SandboxMode>,            // "read-only" | "workspace-write" | "danger-full-access"
  /// Named profile id for this thread. Cannot be combined with `sandbox`.
  #[experimental("thread/start.permissions")]
  pub permissions: Option<String>,
  ```

  The server maps `sandbox` to `ConfigOverrides.sandbox_mode` (`app-server/src/request_processors/thread_processor.rs:1705`), so **`[sandbox_workspace_write]` in `CODEX_HOME/config.toml` still supplies the writable roots and network flag**. `sandbox` and `permissions` together are rejected (`:3862-3866`).
- **`turn/start` takes a full policy:** `sandbox_policy: Option<SandboxPolicy>` (`v2/turn.rs:246`), camelCase on the wire. Generated TS (`app-server-protocol/schema/typescript/v2/SandboxPolicy.ts`):

  ```ts
  export type SandboxPolicy =
    | { type: "dangerFullAccess" }
    | { type: "readOnly"; networkAccess: boolean }
    | { type: "externalSandbox"; networkAccess: NetworkAccess }
    | { type: "workspaceWrite"; writableRoots: AbsolutePathBuf[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };
  ```

  The shipped `ThreadStartParams.ts` lags the Rust (no `permissions`) **(source)**.

### 8. Reads are never restricted by default

- `SandboxPolicy::has_full_disk_read_access()` is literally `true` (`protocol/src/protocol.rs:1331-1333`). The filesystem-policy builder starts both `read_only` and `workspace_write` with a `Root → Read` entry (`protocol/src/permissions.rs:606-613, 818-826`) **(source)**.
- **Seatbelt proof:** with full read access and no unreadable roots the read section is `"; allow read-only file operations\n(allow file-read*)"` (`sandboxing/src/seatbelt.rs:984`), on top of a `(deny default)` base. Linux: `--ro-bind / /` (`linux-sandbox/src/bwrap.rs:417-419`) **(source)**. So a `workspace-write` or `read-only` command can read **anything the user can**, including `~/.ssh`, `~/.aws` and `$CODEX_HOME/auth.json`.
- **A deny-read list exists but is opt-in:** `FileSystemAccessMode { Read, Write, Deny }` (`protocol/src/permissions.rs:120-126`), set through `[permissions.<name>.filesystem]` with `"deny"` values (docs: `"read" | "write" | "deny"`). Seatbelt then emits `(deny file-read* (regex …))` per pattern (`seatbelt.rs:660-661`). Windows unelevated cannot enforce it and refuses to run (`sandboxing/src/windows.rs:117, 128`) **(source)**. Not reachable from `thread/start { sandbox }`; needs a named profile in `config.toml` plus the experimental `permissions` param.
- **Protected write paths inside writable roots:** `.git`, `.agents`, `.codex`, `.aws` stay read-only (`protocol/src/permissions.rs:40-52, 860-863`) **(source)**.

### 9. Platforms and no-sandbox behaviour

`get_platform_sandbox` (`sandboxing/src/manager.rs:50-62`): macOS → `MacosSeatbelt`, Linux → `LinuxSeccomp`, Windows → `WindowsRestrictedToken` only if enabled, else `None` **(source)**.

- **macOS:** `/usr/bin/sandbox-exec` by absolute path, never from `PATH` (`sandboxing/src/seatbelt.rs:58-62`) **(source)**.
- **Linux:** bubblewrap for the filesystem plus `no_new_privs` and seccomp for network and syscalls (`linux-sandbox/src/lib.rs:1-5`, `seccomp.rs:1-5`). Landlock is a deprecated fallback behind `[features].use_legacy_landlock` ("deprecated and will be removed soon", `features/src/tests.rs:474`). **bwrap lookup: system `bwrap` on `PATH` first, else a bundled binary shipped next to the Codex executable** (`codex-resources/bwrap`, SHA-256 checked before exec), else `Unavailable` (`linux-sandbox/src/launcher.rs:135-151`, `bundled_bwrap.rs:41-80`). `Unavailable` **panics** ("bubblewrap is unavailable: no system bwrap was found on PATH and no bundled codex-resources/bwrap binary was found") rather than running unsandboxed (`launcher.rs:59-64`). WSL1 is rejected (`manager.rs:206, 240`). The machine needs unprivileged user namespaces; no kernel-version check was found; docs mention Ubuntu 24.04's AppArmor profile **(source + docs)**.
- **Windows:** `[windows] sandbox = "elevated" | "unelevated" | "mxc"` plus `allow_mxc` (`config/src/types.rs:187-199`); legacy `features.windows_sandbox` / `enable_experimental_windows_sandbox` map to unelevated (`core/src/windows_sandbox.rs:160-180`). Unelevated is `CreateRestrictedToken` plus a Job Object (`windows-sandbox-rs/src/token.rs:21, 501`); no AppContainer in source or docs. **Default is `Disabled`** (`protocol/src/config_types.rs:297-302`). Docs call MXC recommended and the others "legacy fallbacks"; none is labelled experimental **(source + docs)**.
- **No sandbox available (Windows, disabled):** `effective_sandbox_mode` silently **downgrades `workspace-write` to `read-only`** (`config/src/config_toml.rs:826-839`); `select_initial` then yields `SandboxType::None` and the command is launched with no sandbox (`manager.rs:314-330`, `core/src/tools/orchestrator.rs:339-350`). **Codex does not refuse: the command runs unsandboxed under a nominally read-only policy** **(source)**. For `apply_patch`, in-bounds writes fall to `AskUser` instead of auto-approve when no sandbox exists (`core/src/safety.rs:92-123`), matching prior research. The only hard refusal is for profiles with denied reads (`core/src/tools/sandboxing.rs:234-246`).

### 10. Network

- **Per mode, a boolean:** `network_access: bool` on `read-only` and `workspace-write`; `NetworkAccess { restricted, enabled }` on `external-sandbox` (`protocol/src/protocol.rs:1165-1170, 1190-1228`). Off means no `network-outbound` allow in the Seatbelt profile (`seatbelt.rs:368-371`) and, on Linux, `--unshare-net` plus seccomp denying `connect`/`bind` and non-`AF_UNIX` `socket()` (`linux-sandbox/src/bwrap.rs:309-310`, `seccomp.rs:205-233`) **(source)**.
- **A domain allowlist exists, separately and opt-in:** `[features.network_proxy]` / `[permissions.<name>.network]` → `NetworkToml { enabled, proxy_url, domains: map<pattern, allow|deny>, unix_sockets, allow_local_binding, mode, mitm, … }` (`config/src/permissions_toml.rs:247-271, 330-349`). It routes sandboxed traffic through a local proxy; a blocked host surfaces as a `networkApprovalContext` on the approval request with `applyNetworkPolicyAmendment` decisions (`v2/item.rs:1584-1586`). Docs: unset means "no external destinations are allowed until you add `allow` rules… `deny` wins" **(source + docs)**.
- **MCP servers and web search are unaffected:** docs say the proxy does not filter "MCP server connections" **(docs)**; web search is a hosted Responses-API tool (`core/src/tools/hosted_spec.rs:14`; `web_search_call` item, `protocol/src/models.rs:1232-1236`), executed server-side **(source)**.

### 11. The escape hatch

- **Request shape (source):** `item/commandExecution/requestApproval` params (`v2/item.rs:1555-1617`): `kind`, `threadId`, `turnId`, `itemId`, `startedAtMs`, `approvalId?`, `environmentId`, `reason?`, `networkApprovalContext?`, `command?`, `cwd?`, `commandActions?`, `additionalPermissions?` (experimental), `proposedExecpolicyAmendment?`, `proposedNetworkPolicyAmendments?`, `availableDecisions?` (experimental). Response `{ decision }` with (`v2/item.rs:66-85`):

  ```ts
  export type CommandExecutionApprovalDecision =
    | "accept" | "acceptForSession"
    | { acceptWithExecpolicyAmendment: { execpolicy_amendment: ExecPolicyAmendment } }
    | { applyNetworkPolicyAmendment: { network_policy_amendment: NetworkPolicyAmendment } }
    | "decline" | "cancel";
  ```

  There is no distinct "accept without sandbox": the same request is reused, with `reason` set to `"command failed; retry without sandbox?"` (`core/src/tools/orchestrator.rs:644`).
- **Who gets to retry (source):** on `SandboxErr::Denied`, if `!tool.wants_no_sandbox_approval(approval_policy)` the denial goes back to the model with **no** retry (`orchestrator.rs:439-462`). `wants_no_sandbox_approval` (`core/src/tools/sandboxing.rs:345-352`): `UnlessTrusted → true`, **`OnRequest → false`**, `Never → false`, `Granular(g) → g.sandbox_approval`. So under the default `on-request`, Codex does **not** prompt to retry after a failure; the model has to ask up front with `sandbox_permissions: "require_escalated"` on the shell tool ("Request to run outside the sandbox", `protocol/src/models.rs:69-70`), which raises the approval **before** the first attempt.
- **The host can decline:** `decline` makes `request_approval` return `ToolError::Rejected` (`core/src/tools/approvals.rs:437`) and no unsandboxed run happens; `cancel` aborts the turn. **`approval_policy: "never"` fails closed:** "Failures are immediately returned to the model, and never escalated to the user for approval" (`protocol/src/protocol.rs:1116-1118`); it is not "run unsandboxed". `granular { sandbox_approval: false }` auto-rejects escalation (`protocol.rs:1125-1131`). One exception: a user-approved first attempt pre-approves its own unsandboxed retry (`orchestrator.rs:486-492`) **(source)**.

### 12. MCP servers run outside the sandbox

`rmcp-client/src/stdio_server_launcher.rs:1-13` describes the two launch paths; the local one is a plain `Command::new(program).current_dir(cwd).envs(envs).args(args)` with no sandbox wrapper (`:282-290`), and the executor path passes `sandbox: None, enforce_managed_network: false, network_proxy: None` (`:619-636`) **(source)**. Docs agree the network proxy does not filter MCP connections **(docs)**.

---

## What this means for the app

Mapped to the six open questions in #49.

1. **Sandbox in every Tree, or only with commands?** Both sandboxes cover **only shell commands**. A Write-files Tree has no Bash (Claude) or `shell_tool = false` (Codex), so the sandbox adds nothing there; file-tool containment is the permission layer's job (prior research). For "Write files + run commands", Claude needs `sandbox.enabled: true` set by us; Codex is sandboxed by construction on macOS/Linux.
2. **What commands can read.** Codex: **the whole disk, no way around it** from `thread/start`; a deny list needs a named `[permissions.<name>]` profile in our `CODEX_HOME/config.toml` plus the experimental `permissions` param. Claude: whole disk by default; `filesystem.denyRead` (or `credentials.files`) plus matching `Read(...)` deny rules (which merge into `denyRead`) hide `~/.ssh`, `~/.aws`, `~/.config/gh`, keychains. The Claude SDK and the Codex home config are both ours, so both can carry a default deny list. **Neither vendor hides the user's home by default**, so the issue's premise ("the vendor sandboxes' job") holds only if we configure them.
3. **Network.** Claude: default deny with a domain allowlist and a prompt on unknown hosts; the Setup command (`bun install`) needs `registry.npmjs.org`, `github.com` and so on allowed, or the prompt routed to our approval card via `canUseTool` (this prompt is not a tool call; how it surfaces in the SDK is an open item below). `git push` over SSH fails on macOS inside the sandbox. Codex: on/off per Tree (`[sandbox_workspace_write] network_access`), with the proxy allowlist as an opt-in feature. **MCP servers and WebFetch/web search are outside both sandboxes**, so "network off" is only about commands.
4. **No sandbox available.** Linux Claude: `failIfUnavailable` defaults to true through the SDK, so a Tree with commands fails at session start when `bwrap`/`socat` are missing; we can detect this and show "install bubblewrap and socat" rather than run unsandboxed. Linux Codex: **not a problem**: OpenAI ships `bwrap` in `codex-resources/`, which ADR 0008 already downloads whole. Windows: Claude is unsandboxed natively (WSL2 only); Codex is unsandboxed unless `[windows] sandbox` is set, and silently downgrades `workspace-write` to `read-only`. Either refuse commands on Windows, or run with the Codex native sandbox turned on and Claude limited to approvals only.
5. **YOLO never widens the sandbox.** Claude: `allowUnsandboxedCommands: false` plus `failIfUnavailable: true` removes the escape hatch even under `bypassPermissions`; without it, `bypassPermissions` approves `dangerouslyDisableSandbox` retries and unknown hosts **silently**. Codex: default `on-request` never offers a retry; `require_escalated` requests reach us as a normal approval that we `decline`, or `approval_policy: "never"` fails closed. Both are consistent with "never widens what a Tree can do".
6. **Subagents and linked folders.** Both vendors run subagents under the parent's sandbox, so nothing extra. The hard deny on other Branches' files maps to Claude `filesystem.denyRead` and Codex deny entries only in a named profile; otherwise a Codex command in one working copy can read every other working copy in `userData`. Repo-level `.claude/settings*.json` cannot loosen the sandbox once we set `allowUnsandboxedCommands: false`.

## Unverified

- Codex's exact release version matching `main@3bae578` (workspace version is `0.0.0`); whether the lagging `ThreadStartParams.ts` is an unregenerated file or an intentional experimental strip.
- Claude: how the network "unknown host" prompt surfaces in the SDK (it is not a `canUseTool` tool call; SRT exposes a `SandboxAskCallback`, `README.md:321-331`). Whether `sdk.mjs`'s internal `sandbox.enabledPlatforms` key ever enables SRT's native Windows backend; the public types and docs say no.
- macOS read-deny semantics for symlinks (SRT documents the rules for Linux only).
- Codex: Linux minimum kernel; the end-to-end tool result when bwrap is absent (the panic path was read, not traced to the model's view); whether `thread/start.permissions` named profiles with `"deny"` work from app-server (experimental flag).
- All platform behaviour, since no live tests were run; Windows in particular.
