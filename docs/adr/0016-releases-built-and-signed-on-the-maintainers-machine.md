# Releases are built and signed on the maintainer's machine

Every release artifact, app bundles and shells for all three OSes alike, is built by `bun run release` on the maintainer's Mac, from a diff the maintainer has reviewed since the source commit of the newest bundle in the current signed manifest. CI never builds anything that ships. [ADR 0007](./0007-thin-shell-signed-app-bundles.md)'s guarantee is that a compromised GitHub account can't push code to existing installs, but signing a CI-built artifact, or a local build of a commit pulled from GitHub without reading it, signs whatever that account put there: it can move tags and push straight to `main`. Findings: [Repo layout, build toolchain and testing strategy](https://github.com/qodesmith/unimatrix-zero/issues/41).

## Considered Options

- **CI builds, the maintainer signs its drafts** (ADR 0007 as first written). Rejected: CI's output is whatever the account's code and workflows produce.
- **Rebuild locally and require a byte-for-byte match with CI's draft.** Rejected: signing the local build directly gives the same guarantee, and the NSIS installer isn't reproducible and Rolldown has open nondeterminism bugs.
- **CI builds the Windows and Linux shells, recorded as an accepted risk.** Kept only as the fallback: electron-builder builds an unsigned x64 NSIS installer and an x64 AppImage on Apple Silicon without Wine or Docker, but only with the beta `toolsets: {nsis: '1.2.1', appimage: '1.0.3'}`.

## Consequences

- **The manifest records each bundle's source commit**, beside its version, SHA-256, `minShell` and detached Ed25519 signature; the `.asar` is never modified by signing. That commit is the review baseline, which an attacker can't move the way they can move a tag. With no manifest the script runs only with `--first-release`, showing the full commit list, a `git diff --stat` of the whole tree and `bun.lock`, and confirmed by typing the HEAD commit id; a manifest that can't be fetched or fails verification stops the release rather than falling back to first-release mode.
- **The release order**, the same for `v*` bundles and `shell-N` shells:
  1. Preflight: clean tree, HEAD already on `origin/main`, `bun install --frozen-lockfile` changes nothing, manifest fetched and verified, then the commit list and full diff since the baseline (`bun.lock` included), confirmed by the maintainer.
  2. Build locally and create the tag locally only.
  3. Live tests against the exact `.asar`, loaded through a manifest signed with the test key.
  4. Upload drafts (`gh release create <tag> --draft --target <sha>`); a draft doesn't create the tag on GitHub.
  5. `gh workflow run smoke.yml` with the tag, commit and SHA-256s, then `gh run watch --exit-status`. The workflow checks each draft asset against the hashes it was given, builds its own manifest signed with the test key, and runs the test-build shell (bundles) or the real artifacts (shells) on Mac arm64, Mac x64, Windows x64 and Linux x64. Workflows don't trigger on draft releases, hence the manual dispatch.
  6. Only after the smoke passes: read the key from Bitwarden into memory, sign the real manifest, and check it covers the SHA-256s that were smoke-tested.
  7. Push the tag and check the remote tag resolves to the expected commit.
  8. Publish (`gh release edit --draft=false`, plus `--latest=false` for shells, so GitHub's Latest is always the product).
  9. Push the signed manifest to Pages, the moment clients see the release.
- **The real key signs nothing until the smoke has passed**, so an aborted release leaves no valid signed manifest for anyone with the account to push to Pages. Before step 7 an abort deletes the draft and the local tag, and the next run cleans up after a hard kill. Between steps 7 and 9 the release is public but unreferenced, and `bun run release --resume <tag>` checks the published assets against the kept local build output, re-signs and pushes. A version number is never reused for different bytes.
- **The key never touches disk**: it's read from `bw get`'s stdout and used with `node:crypto`, never in a file, argv or the environment.
- **The test key is checked into the repo.** Only test builds trust it, and the packaged smoke test checks that real shells reject a manifest signed with it.
- **Shells embed the newest published signed bundle**, and a bundle that needs a new shell ships after that shell.
- **CI's job is checking, not shipping:** PR checks, PR-built bundles for E2E, the smoke workflow, the weekly vendor bump ([ADR 0008](./0008-app-managed-vendor-programs.md)) and Electron advisories ([ADR 0014](./0014-electron-security-posture.md)). There is no `v*` tag workflow; the release script creates the tags.
- **A malicious change merged through a reviewed PR is out of scope**: only review guards against it.
