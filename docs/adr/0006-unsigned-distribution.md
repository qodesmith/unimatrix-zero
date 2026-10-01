# Unsigned distribution via GitHub Releases

Unimatrix Zero ships without paid code signing: ad-hoc signed on Mac (`mac.sign.identity: "-"`, without which downloads show as "damaged"), unsigned on Windows and Linux, built by electron-builder on a GitHub Actions matrix and published to GitHub Releases from `v*` tags, with a GitHub Pages download page and `install.sh` scripts. The project rule is no paid developer accounts and no infrastructure; Apple Developer ID, Windows OV/Azure signing, and app stores all break it, and SignPath Foundation's free signing wasn't worth the per-release review. Findings: [unsigned distribution research](https://github.com/qodesmith/unimatrix-zero/blob/research/unsigned-distribution/docs/research/unsigned-distribution.md), and the quarantine experiments on [Distribution and update strategy](https://github.com/qodesmith/unimatrix-zero/issues/13).

## Consequences

- **Squirrel.Mac can never update the app.** An ad-hoc designated requirement is the build's `cdhash`, so each build rejects the next. Updates go through our own thin shell and signed app bundles instead ([ADR 0007](./0007-thin-shell-signed-app-bundles.md)).
- **Each new Mac build loses macOS's trust state.** Keychain items and privacy grants (Documents, Desktop, Downloads) are tied to the `cdhash` and prompt again after a shell update. The app therefore keeps no secrets of its own (no `safeStorage`); adding one means revisiting ADR 0007.
- **First install on Mac means Open Anyway** for a browser download, even for a build approved before. `install.sh` avoids it because `curl` doesn't add quarantine; the app's own downloads don't either. A quarantined app not moved by Finder is translocated to a read-only path, so the app calls `moveToApplicationsFolder()` on first launch.
- **Windows Smart App Control users can't run the app** and are told how to turn SAC off. SmartScreen's "Run anyway" returns for every new shell installer.
- **Linux ships only an AppImage**, installed by `install.sh` into `~/.local/bin` with a menu entry. `.deb`/`.rpm` were dropped because a root-owned install can't update itself.
- If the project ever pays for signing, the trust-state resets, Open Anyway and SAC all go away without changing the update design.
