# app

An Electron application with React and TypeScript.

Tooling: [electron-vite](https://electron-vite.org/) · [oxlint](https://oxc.rs/docs/guide/usage/linter) · [oxfmt](https://oxc.rs/docs/guide/usage/formatter) · [Bun](https://bun.sh) (package manager / script runner — app code runs in Electron's built-in Node)

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [Oxc](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode)

## Project Setup

### Install

```bash
$ bun install
```

### Development

```bash
$ bun run dev
```

### Lint / Format / Typecheck

```bash
$ bun run lint
$ bun run format
$ bun run typecheck
```

### Build

```bash
# For windows
$ bun run build:win

# For macOS
$ bun run build:mac

# For Linux
$ bun run build:linux
```

## Notes

- Native deps: after adding one, run `bun pm trust <pkg>` so its build script runs; `postinstall` rebuilds against Electron's ABI automatically.
- Don't use Bun-only APIs (`Bun.file`, `bun:sqlite`) in `src/main` or `src/preload` — they run in Electron's Node.
