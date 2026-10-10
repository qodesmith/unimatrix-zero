# The app's stored identity is separate from its display name

The app ships as "Unimatrix Zero", but nothing stored on disk is derived from that name. Four identifiers are fixed from the first public release and never change: the `appId` `com.qodesmith.unimatrixzero`, the `userData` folder `unimatrix-zero`, the Archive format id `unimatrix-zero-archive`, and the Linux binary/AppImage name `unimatrix-zero`. Electron derives `userData` from `productName` by default, so renaming the app would strand every user's Trees, app bundles and vendor programs ([ADR 0007](0007-thin-shell-signed-app-bundles.md), [ADR 0008](0008-app-managed-vendor-programs.md)). The name borrows from Star Trek (owned by Paramount), and we accepted the small risk of being asked to rename, which is one more reason to keep the name free to change. Findings: [App name, sidebar label and visual identity](https://github.com/qodesmith/unimatrix-zero/issues/33).

## Consequences

- **The shell sets the path, not the app bundle.** `app.setPath('userData', …)` runs in the shell's loader before anything reads `userData`, because the app bundles themselves live there.
- **A rename only touches `productName`** (window title, installer, menu bar). On Mac the `.app` name and on Windows the Start-menu entry change with it, so a rename ships as a shell update.
