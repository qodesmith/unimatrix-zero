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

Inside a package, code lives in deep modules: `src/modules/<name>/main.ts` is the only file another module may import, written as `#modules/<name>/main`. Everything else in the folder is private, tests sit beside their unit, and `.tsx` files live under a `ui/` folder. The `uz/module-boundaries` and `uz/tsx-under-ui` lint rules in `tooling/oxlint/uz/` enforce this.

### Colors

Every color, radius and font in the UI is a Theme token (ADR 0009): the Hearth light and dark sets in `app/renderer/src/modules/theme/hearth.ts`, applied as CSS variables and mapped into Tailwind in `styles.css`. `uz/no-hardcoded-colors` fails the build on a palette class or a color literal anywhere under `app/renderer/src` except the `theme` module, which is where the token values live; `scripts/check-css-tokens.ts` does the same for CSS.

## Linting

`oxlint.config.ts` holds every rule, one entry per rule, type-aware, with warnings failing the run. Beside oxlint's own plugins it loads two JS plugins: `uz` (`tooling/oxlint/uz/`: module boundaries, `.tsx` under `ui/`, Theme-token colors, and tests that assert on their own fixtures) and `anti-slop` (`tooling/oxlint/anti-slop/`, a copy of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) installed by the `install-anti-slop` skill; its `UPSTREAM.md` names the source commit). Each `uz` rule has a test beside it that runs the real oxlint over fixtures.

A disable comment carries its reason after `--`, and one that no longer suppresses anything fails the run. The `lint-fixing` skill has the fixes for the rules whose obvious fix is wrong.

oxlint ships new rules most weeks. `reviewed-oxlint-version` in `package.json` names the release whose rule changes someone read, and `bun run lint` fails when the installed oxlint differs. After a bump, read the release notes since that version (`gh release list -R oxc-project/oxc | grep oxlint_v`), turn on what fits, pin tooling's `@oxlint/plugins` to the same version, and update the field.

## Tests

Vitest runs in two projects: `node` (contract, main, hosts, shell, scripts) and `renderer` (browser mode in Chromium). `bun run test` runs both under Electron's own Node, and `scripts/runtime-match.test.ts` fails if the Node or SQLite version differs from `electron-runtime.json`. After bumping Electron, run `bun run electron-runtime` to regenerate that file and `.node-version`.

CI runs the checks on Linux and the tests on Mac arm64, Mac x64, Windows x64 and Linux x64. There are no git hooks.
