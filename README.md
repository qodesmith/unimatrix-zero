# Unimatrix Zero

A canvas where one collective conversation splits into individual threads.

## Working on it

Needs [Bun](https://bun.sh) at the version in `.bun-version` and Node at the version in `.node-version` (the Node that the pinned Electron ships).

```sh
bun install          # isolated installs: a package can import only what it declares
bun run dev          # the window, served through app-dev://, rebuilding on change
bun run check        # format, lint, typecheck, knip and tests: what CI runs
```

Each worktree gets its own ports and data folder (`unimatrix-zero-dev-<hash>` under the OS app-data folder), so two checkouts run side by side and sign in separately.

## Layout

A Bun-workspaces monorepo, one private package per process plus the contract:

```text
shell/              the thin loader that becomes the installed app (placeholder for now)
app/main/           the hub: SQLite, Provider hosts, the one window
app/preload/        window.uz = { send, subscribe, registerDroppedFile }, one self-contained CJS file
app/renderer/       React, Tailwind and shadcn, styled only by Theme tokens
app/provider-host/  one utility process per Provider: claude and chatgpt entries
shared/contract/    Zod schemas for commands and events; every type derives from them
tooling/            the shared Vite build helper and the repo's own lint rules
scripts/            dev loop, test runner, runtime pinning
```

`tsc -b` project references keep main, the Provider hosts and the renderer from importing each other: only `@uz/contract` is shared.

### Modules

Inside a package, code lives in deep modules: `src/modules/<name>/main.ts` is the only file another module may import, written as `#modules/<name>/main`. Everything else in the folder is private, tests sit beside their unit, and `.tsx` files live under a `ui/` folder. The `uz/module-boundaries` and `uz/tsx-under-ui` lint rules in `tooling/oxlint/plugin.ts` enforce this.

### Colors

Every color, radius and font in the UI is a Theme token (ADR 0009): the Hearth light and dark sets in `app/renderer/src/modules/theme/hearth.ts`, applied as CSS variables and mapped into Tailwind in `styles.css`. `uz/no-hardcoded-colors` fails the build on a palette class or a color literal anywhere under `app/renderer/src` except the `theme` module, which is where the token values live; `scripts/check-css-tokens.ts` does the same for CSS.

## Tests

Vitest runs in two projects: `node` (contract, main, hosts, shell, scripts) and `renderer` (browser mode in Chromium). `bun run test` runs both under Electron's own Node, and `scripts/runtime-match.test.ts` fails if the Node or SQLite version differs from `electron-runtime.json`. After bumping Electron, run `bun run electron-runtime` to regenerate that file and `.node-version`.

CI runs the checks on Linux and the tests on Mac arm64, Mac x64, Windows x64 and Linux x64. There are no git hooks.
