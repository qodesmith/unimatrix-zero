# SQLite + Drizzle in an Electron + Bun app

Research for [#8](https://github.com/qodesmith/unimatrix-zero/issues/8), part of the [v1 spec map #1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-09-27.

**Question:** How should SQLite + Drizzle run in an Electron app built with Bun and packaged for Mac, Windows and Linux? This covers driver choice, where the database lives, migrations, using Bun alongside Electron's Node runtime, and whether TanStack DB belongs in front of the database.

## Answer in brief

- **Driver: `node:sqlite` through `drizzle-orm/node-sqlite`.** It is compiled into Electron, so there is no native module to rebuild, unpack or cross-compile. It ran Drizzle queries and migrations inside Electron 44 in a local test. better-sqlite3 v13 is a close second: it moved to N-API in July 2026, and its bundled prebuilds also loaded in Electron 44 with no rebuild.
- **Drizzle version: this requires Drizzle 1.0 (currently `drizzle-orm@rc` / `drizzle-kit@rc`).** Stable 0.45.x has no `node-sqlite` driver. The Drizzle docs now tell you to install `@rc`.
- **The database lives at `path.join(app.getPath('userData'), 'data', 'unimatrix.sqlite')`.** It is opened in the **main process** (or a `utilityProcess`), never in the renderer.
- **Migrations: `drizzle-kit generate` at dev time, then `migrate()` from `drizzle-orm/node-sqlite/migrator` on every app start.** The migrations folder ships with the app. The Drizzle migrator reads it from inside `app.asar` without problems (tested).
- **Critical gotcha:** Drizzle's SQLite migrator wraps each migration in a transaction, which silently cancels the `PRAGMA foreign_keys=OFF` in table-rebuild migrations. A rebuild of a parent table with an `ON DELETE CASCADE` child then **silently deletes every child row**. I reproduced this on 1.0.0-rc.4, and our Tree schema is exactly this shape. The workaround is to run `PRAGMA foreign_keys=OFF` _before_ calling `migrate()`, then `PRAGMA foreign_key_check`, then turn the pragma back on (tested).
- **Bun:** use it as the package manager and script runner. Electron still runs its own Node 24. Bun 1.4.2 can run `node:sqlite`, better-sqlite3 13 and `drizzle-kit`. Bun 1.3.x cannot load `node:sqlite`.
- **TanStack DB: not for v1.** Its Electron SQLite persistence package exists, but it keeps its own JSON key/value tables alongside Drizzle's rather than using them, and it depends on the pre-N-API better-sqlite3 12, which needs a rebuild. Use **TanStack Query over typed IPC** instead, with the main process pushing invalidation events.

## 1. What Electron ships

The Electron release feed (`https://releases.electronjs.org/releases.json`), fetched 2026-09-27:

| Electron        | Date       | Node    | Chromium | NODE_MODULE_VERSION |
| --------------- | ---------- | ------- | -------- | ------------------- |
| 44.4.5 (latest) | 2026-09-23 | 24.21.0 | 152      | 149                 |
| 43.7.5          | 2026-09-23 | 24.21.0 | 150      | 148                 |
| 42.11.8         | 2026-09-23 | 24.19.0 | 148      | 146                 |
| 40.10.6         | 2026-07-01 | 24.15.0 | 144      | 143                 |
| 39.8.10         | 2026-05-05 | 22.22.1 | 142      | 140                 |

**`node:sqlite` in Node 24.21.** The module history in the [Node docs](https://nodejs.org/dist/v24.21.0/docs/api/sqlite.md) says it is unflagged since v22.13 / v23.4 ([nodejs/node#55890](https://github.com/nodejs/node/pull/55890)) and has been "Stability: 1.2 - Release candidate" since **v24.15.0** ([nodejs/node#61262](https://github.com/nodejs/node/pull/61262)). It is not "Stable (2)" yet, not even in Node 26.10 (the current `latest` docs). The API is `DatabaseSync` / `StatementSync`, and it is synchronous, like better-sqlite3.

**In Electron specifically.** Electron 37.2.0 briefly shipped without the sqlite binding ([electron/electron#47671](https://github.com/electron/electron/issues/47671), "No such binding: sqlite"). [#47706](https://github.com/electron/electron/pull/47706) fixed it and was backported to 36, 37 and 38 in July 2025. **Verified locally:** in Electron 44.4.5's main process, `process.versions` reports node 24.21.0 and sqlite 3.53.4. `drizzle-orm/node-sqlite` opened a file database, ran migrations, inserted and selected, and printed no ExperimentalWarning to the console.

## 2. Driver comparison

|                          | `node:sqlite`                               | better-sqlite3 13                                                                                           | libsql (`@libsql/client`)                                                                                                              | `bun:sqlite`                  |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Drizzle driver           | `drizzle-orm/node-sqlite` (**1.0 rc only**) | `drizzle-orm/better-sqlite3` (0.45 stable and 1.0 rc)                                                       | `drizzle-orm/libsql`                                                                                                                   | `drizzle-orm/bun-sqlite`      |
| Sync/async               | sync                                        | sync                                                                                                        | async                                                                                                                                  | sync                          |
| Native module?           | **No**, built into Electron                 | Yes, N-API since v13.0.0                                                                                    | Yes, napi-rs, one optional package per platform                                                                                        | n/a                           |
| Rebuild for Electron ABI | none                                        | **none needed from v13** (verified on Electron 44); v12 and earlier needed `@electron/rebuild`              | none (N-API)                                                                                                                           | n/a                           |
| Packaging                | nothing to do                               | `.node` must be unpacked from asar (electron-builder `smartUnpack` / Forge `auto-unpack-natives` handle it) | same, plus the correct `@libsql/<platform>` optional dependency must be installed for each target; there is **no win32-arm64 package** | n/a                           |
| Maturity                 | Node "Release candidate" (1.2)              | mature and widely used, but N-API v13 is only 2 months old                                                  | Turso fork; its value is remote sync, which we do not need                                                                             | Bun runtime only              |
| Fit                      | **Recommended**                             | Fallback                                                                                                    | No                                                                                                                                     | Scripts only; not in Electron |

**Sources.**

- The Drizzle SQLite getting-started page (`https://orm.drizzle.team/docs/get-started-sqlite`) lists libsql, node:sqlite and better-sqlite3, all installed with `drizzle-orm@rc`.
- `npm view drizzle-orm@0.45.3 exports` has no `./node-sqlite`, while `1.0.0-rc.4` has one. The npm `latest` tag is 0.45.3 (2026-09-21) and `rc` is 1.0.0-rc.4 (2026-06-27).
- The [better-sqlite3 v13.0.0 release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) says: "the first version of better-sqlite3 to run on the N-API … prebuilt binaries should theoretically work across different versions of Node.js and Electron". The npm tarball ships `prebuilds/{darwin,linux,linuxmusl,win32}-{x64,arm64}.node`.
- `npm view libsql@0.5.29 optionalDependencies` lists darwin x64/arm64, linux gnu/musl x64/arm64/arm, and win32-x64 only.

**Performance.** Measured locally in the Electron 44 main process on an Apple Silicon Mac, WAL mode, 100k rows with 500-byte bodies. Numbers are consistent across two runs:

|                   | insert 100k (one tx) | 100k point `get` | `all()` of 100k |
| ----------------- | -------------------- | ---------------- | --------------- |
| node:sqlite       | ~240 ms              | ~192 ms          | ~59 ms          |
| better-sqlite3 13 | ~258 ms              | ~163 ms          | ~46 ms          |

Both are far faster than a chat app needs. Performance does not decide between them.

**Why `node:sqlite` over better-sqlite3.** It removes the whole native-module category from the build: no `@electron/rebuild`, no asar unpacking, no per-platform binary, and no cross-compiling worries when producing Windows or Linux builds. T3 Code made the same choice (section 6). The remaining risks and their answers:

- _It is still "release candidate" in Node._ The API is small, and the Drizzle layer insulates us from it.
- _Drizzle's node-sqlite driver exists only in the 1.0 rc._ We would start on Drizzle 1.0 anyway, since 1.0 changes the migration folder format.

If either risk bites, switching to better-sqlite3 13 means changing one import line in Drizzle.

Note on sync drivers: Drizzle maintainers say async callbacks inside transactions are unsupported for every synchronous driver ([drizzle-orm#5474](https://github.com/drizzle-team/drizzle-orm/issues/5474)). Keep transaction bodies synchronous.

## 3. Where the database lives, and which process owns it

- Use `app.getPath('userData')`. The Electron docs define it as "the directory for storing your app's configuration files, which by default is the `appData` directory appended with your app's name". They recommend storing app files in a **subdirectory** so they do not collide with Chromium's own folders ([app docs](https://www.electronjs.org/docs/latest/api/app)). So use `userData/data/unimatrix.sqlite`.
  - macOS: `~/Library/Application Support/<App Name>/`
  - Windows: `%APPDATA%\<App Name>\`
  - Linux: `$XDG_CONFIG_HOME/<App Name>/` or `~/.config/<App Name>/`
- The app name drives this path, and the app name is still undecided (see map #1). **Renaming the app later moves userData**, so fix the `name`/`productName` before the first public release, or pin the path with `app.setPath('userData', …)` early in startup.
- In dev, point the path at a separate file (`userData/data/dev.sqlite`, or a repo-local `.data/`) so development never touches real data. T3 Code does the same with separate `dev` and `userdata` state dirs.
- **The DB must be owned by the main process or an Electron `utilityProcess`.** The renderer is sandboxed and cannot load Node modules. Both drivers are synchronous, so a slow query blocks whichever process runs it. For v1's workload (small writes per Turn, reads per Tree), the main process is fine if Reply text is persisted in chunks or on completion rather than per token. If profiling shows jank, the upgrade path is to move the DB into a `utilityProcess` behind the same IPC interface. _Not verified with a prototype._
- Set on open: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`. T3 Code sets these same pragmas in `apps/server/src/persistence/Layers/Sqlite.ts`.

## 4. Migrations

**Flow**

1. Keep the Drizzle schema in TS (for example `src/main/db/schema.ts`), with `drizzle.config.ts` set to `dialect: 'sqlite'`, `out: './drizzle'`.
2. `bunx drizzle-kit generate` creates `drizzle/<timestamp>_<name>/migration.sql` + `snapshot.json`. This is the Drizzle 1.0 layout, one folder per migration with no `_journal.json`. Verified with drizzle-kit 1.0.0-rc.4.
3. On app start, open the DB, then run `migrate(db, { migrationsFolder })` from `drizzle-orm/node-sqlite/migrator`, then show the window. Drizzle records applied migrations in `__drizzle_migrations`.
4. Ship the `drizzle/` folder with the app. **Verified:** Drizzle's migrator read a migrations folder packed inside an `.asar` in Electron 44 and applied it. This works because Electron patches `readFileSync`/`readdirSync` for asar paths ([ASAR docs](https://www.electronjs.org/docs/latest/tutorial/asar-archives)). So the folder can be bundled into `app.asar` (for example next to the main bundle) and resolved relative to `app.getAppPath()`. `extraResources` + `process.resourcesPath` also works.
5. Never use `drizzle-kit push` against user databases. It is for local dev only (Drizzle's [migrations overview](https://orm.drizzle.team/docs/migrations) lists "generate + runtime migrate" as its own strategy).

**The FK cascade data-loss bug (must handle)**

- [drizzle-orm#5782](https://github.com/drizzle-team/drizzle-orm/issues/5782) is open. It was reported by an Electron + better-sqlite3 app whose users lost all their chat messages. Its title is "SQLite table-rebuild migrations silently wipe child tables for any FK with `ON DELETE CASCADE`".
- For changes plain `ALTER TABLE` cannot express, drizzle-kit emits a table rebuild wrapped in `PRAGMA foreign_keys=OFF; … DROP TABLE parent; … PRAGMA foreign_keys=ON;`.
- The migrator runs each migration inside `BEGIN … COMMIT`. SQLite documents `PRAGMA foreign_keys` as a no-op inside a transaction, so `DROP TABLE parent` acts as an implicit `DELETE` and cascades.
- **Reproduced locally on drizzle-orm/drizzle-kit 1.0.0-rc.4 with `node:sqlite`.** The schema was `trees` ← `turns.tree_id ON DELETE CASCADE`, plus a self-referencing `turns.parent_id ON DELETE CASCADE`. Changing the default of one `trees` column generated a rebuild migration, and applying it dropped `turns` from 2 rows to 0 with no error.
- A Tree schema will almost certainly use `ON DELETE CASCADE`: the v1 decision says "deleting a Prompt removes everything below it". So this bug applies directly.
- **Workaround (verified):** run `PRAGMA foreign_keys = OFF` on the connection _before_ `migrate()`. After it, run `PRAGMA foreign_key_check` (fail loudly if it returns rows), then `PRAGMA foreign_keys = ON`. With that order the same migration kept both rows.
- Also back up the DB file before migrating when there are pending migrations. `node:sqlite` has `sqlite.backup()`, and `VACUUM INTO` also works. Keep the last N backups.

**Downgrades.** Drizzle has no down-migrations. If a user runs an older build against a newer DB, the old build sees unknown rows in `__drizzle_migrations`. Its behaviour is _unverified_. The simplest policy is to refuse to open a DB with migrations the app does not know about, and to say so in the UI.

## 5. Bun for development when Electron's runtime is Node

- **Electron always runs its own bundled Node (24.21 in Electron 44)**, whatever tool launched it. Bun is the package manager, the script runner and possibly the bundler driver. It is never the app runtime.
- **Electron's binary download:** the Electron docs say the binary "is downloaded by default the first time you run Electron … or manually via `npx install-electron`" ([installation docs](https://github.com/electron/electron/blob/main/docs/tutorial/installation.md)). With Electron 44, `bun add electron` left no `dist/` folder until first run or `install-electron`. This matters for CI caching. Verified locally.
- **Native modules and Bun's blocked lifecycle scripts:** Bun does not run install scripts for untrusted dependencies. With `node:sqlite` this does not matter. With better-sqlite3 13, prebuilds ship inside the package, so no script is needed either.
- **Running `node:sqlite` code under Bun:** Bun 1.4.2 (local) loads `node:sqlite` and runs `drizzle-orm/node-sqlite`. Bun 1.3.x cannot ([drizzle-orm#5515](https://github.com/drizzle-team/drizzle-orm/issues/5515), where `bun --bun x drizzle-kit …` fails with `Could not resolve: "node:sqlite"`), so pin Bun ≥ 1.4 in `packageManager`/CI. Open Bun bugs in its `node:sqlite` emulation include a Windows file lock after `close()` ([oven-sh/bun#40001](https://github.com/oven-sh/bun/issues/40001)) and bare named parameters binding NULL ([#39877](https://github.com/oven-sh/bun/issues/39877)). These only affect scripts or tests run _under Bun_, never the shipped app.
- **Recommendation:** use `bunx drizzle-kit generate` freely, because it only diffs TS schemas. Run DB-touching tests and scripts **in Electron's Node**, or with plain `node` at the same major version. A Bun-hosted test run exercises Bun's reimplementation of `node:sqlite`, not the one users run. [drizzle-orm#3221](https://github.com/drizzle-team/drizzle-orm/issues/3221) ("Making drizzle-kit work with Electron") shows the mirror-image issue with better-sqlite3 ≤ 12: a binary built for Electron's ABI fails when drizzle-kit runs it under system Node. N-API in v13 should end this, but that is _unverified for drizzle-kit studio_.

## 6. What T3 Code does

Inspected [pingdotgg/t3code](https://github.com/pingdotgg/t3code) at `de251fc2971a884cb5b1305ba4daf309dc8cccb0`:

- **Driver: `node:sqlite`.** `packages/shared/src/nodeSqliteClient.ts` is a port of `@effect/sql-sqlite-node` "that uses the native `node:sqlite` bindings instead of `better-sqlite3`". It has a runtime check for Node ≥ 22.16 / 23.11 / 24. There is no SQLite package in any dependency list.
- **No Drizzle.** It uses Effect SQL with raw tagged-template queries, in an event store (`orchestration_events`) plus projection tables.
- **Migrations:** 54 hand-written TS migrations (`apps/server/src/persistence/Migrations/0NN_*.ts`) run by Effect's `Migrator` at server startup.
- **Process model:** the DB lives in a separate backend server, which Electron spawns with `process.execPath` and `ELECTRON_RUN_AS_NODE=1`, so it uses Electron's bundled Node (`apps/desktop/src/backend/DesktopBackendConfiguration.ts`). The renderer talks to it over **WebSocket RPC**, not IPC, so the same UI also runs in a browser. Electron IPC is used only for desktop-shell features.
- **Location:** `~/.t3/userdata/state.sqlite` (or `~/.t3/dev/…`), not Electron's userData.
- **Packaging:** electron-builder 26.15.6, Electron 44.4.2. SQLite needs no native handling. `asarUnpack` exists only for other native modules (node-pty, keyring).
- **Tooling:** pnpm plus `node` for scripts. Bun is not used.
- **Renderer state:** `@effect/atom-react` + zustand. It uses TanStack Router and Pacer, but not TanStack Query or DB.

**Takeaway:** a production Electron 44 app ships `node:sqlite` today with no native-module handling. Its separate-process + WebSocket design serves goals we do not have (a browser and mobile client, a standalone CLI). A single app with IPC to the main process is enough for us.

## 7. Is TanStack DB worth it?

**What exists.** TanStack DB is at **0.9.2** (pre-1.0). Its docs list Query, Electric, TrailBase, RxDB, PowerSync, LocalStorage and LocalOnly collections. The repo ([TanStack/db](https://github.com/TanStack/db) at `4b9617c`) also has `@tanstack/electron-db-sqlite-persistence` (0.1.35, first published 2026-03-25). It is not in the docs site's collection list, but it has a README and an `examples/electron/offline-first` example. It exposes the persistence from the main process over `ipcMain` and gives the renderer `persistedCollectionOptions` collections, plus multi-renderer leader election.

**Why it does not fit Drizzle:**

- **It owns its own schema.** `db-sqlite-persistence-core` creates a table per collection with `key TEXT PRIMARY KEY, value TEXT NOT NULL, metadata TEXT, row_version INTEGER`, plus about 9 bookkeeping tables (`collection_registry`, `applied_tx`, `leader_term`, …) (`packages/db-sqlite-persistence-core/src/sqlite-core-adapter.ts`). Rows are JSON blobs. It would sit _beside_ the Drizzle schema, not in front of it, which means two sources of truth, or giving up Drizzle.
- **Its main-process driver** (`@tanstack/node-db-sqlite-persistence`) hard-depends on `better-sqlite3@^12.6.2`. That is the pre-N-API line, which needs `@electron/rebuild`, and it does not use `node:sqlite`.
- Its design (leader election, `IndeterminateCommitError`, tombstones) solves multi-writer and sync problems. v1 has one window, one writer and no sync.

**Recommendation:** skip TanStack DB for v1. Use **TanStack Query** in the renderer over a small typed IPC API (`ipcRenderer.invoke` → main → Drizzle). The main process emits change events (`tree:updated`, `turn:appended`) that call `queryClient.invalidateQueries` or `setQueryData`. Keep streaming Reply tokens as ephemeral renderer state fed by IPC events, and persist them in the main process. A `LocalOnlyCollection` or `QueryCollection` could be added later if live cross-Tree queries become painful. _Not verified with a prototype._ The IPC shape overlaps with the unspecified "Electron security posture" item on the map.

## 8. Packaging notes (electron-builder vs Forge)

- With `node:sqlite`, the DB layer adds **nothing** to packaging config under either tool.
- With better-sqlite3 13:
  - **electron-builder:** `npmRebuild` defaults to running `@electron/rebuild`, and `smartUnpack` unpacks native files automatically. From electron-builder's JSON schema: `npmRebuild`: "Whether to rebuild native Node.js modules for the target Electron version and architecture"; `smartUnpack`: "Whether to automatically unpack executables files". With N-API prebuilds, `npmRebuild: false` should work. _Unverified in a real packaged build._
  - **Forge:** use `@electron-forge/plugin-auto-unpack-natives`, which "automatically adds all native Node modules found in your node_modules folder to the asar.unpack configuration" ([docs](https://www.electronforge.io/config/plugins/auto-unpack-natives)).
- The choice between builder and Forge belongs to the distribution / build-toolchain tickets. The DB layer doesn't constrain it.

## Unverified / open

- A full packaged build (electron-builder or Forge) on Windows and Linux with `node:sqlite`. It was only tested unpackaged on macOS arm64. Electron compiles `node:sqlite` in for all platforms per #47706, but I did not run it there.
- Whether Electron 44 prints an ExperimentalWarning for `node:sqlite` anywhere (none seen on the console on macOS).
- Drizzle 1.0 GA timing. The rc has been out since April 2026 and stable is still 0.45.x.
- How an older app build behaves against a newer DB (unknown migrations).
- Whether main-process sync writes cause UI jank with several concurrently streaming Threads. Expected to be fine with batched writes, but not measured.
