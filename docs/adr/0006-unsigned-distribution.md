# Unsigned distribution via GitHub Releases

Unimatrix Zero ships without paid code signing: ad-hoc signed on Mac (`mac.sign.identity: "-"`, without which downloads show as "damaged"), unsigned on Windows and Linux, built by electron-builder on a GitHub Actions matrix and published to GitHub Releases from `v*` tags, with a GitHub Pages download page. The project rule is no paid developer accounts and no infrastructure; Apple Developer ID, Windows OV/Azure signing, and app stores all break it, and SignPath Foundation's free signing wasn't worth the per-release review. Findings: [unsigned distribution research](https://github.com/qodesmith/unimatrix-zero/blob/research/unsigned-distribution/docs/research/unsigned-distribution.md).

## Consequences

- **Mac can never update in place.** Squirrel.Mac checks the new build against the running app's designated requirement, and an ad-hoc requirement is tied to one build. Mac updates download the matching `.dmg` in-app, check its SHA-512, and open it for the user to drag into Applications. Releases are batched to limit this friction.
- **Windows Smart App Control users can't run the app** and are told how to turn SAC off. SmartScreen's "Run anyway" returns for every release.
- **Windows update integrity rests on the SHA-512 in `latest.yml`**, via a custom `verifyUpdateCodeSignature`, because electron-builder will fail closed on unsigned updates from v28. Move to Ed25519-signed manifests once they're stable.
- No update downloads until the user clicks: every OS shows "Update available" first.
- If the project ever pays for signing, Mac auto-update, SAC support and SmartScreen reputation all come back without changing the update UI.
