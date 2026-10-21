# 19. Reports and Diagnostics

Source: [Crash and bug reporting without PII](https://github.com/qodesmith/unimatrix-zero/issues/47), [ADR 0017](../../adr/0017-reports-go-through-a-stateless-relay-into-github-issues.md).

- **"Report a problem…"** shows a picker, an optional description (required when there is no error; at most 2,000 characters, fenced and treated as untrusted), a "What's included" list and "Show exact text", then Send, then "Sent as #123". Nothing is sent without that preview and click; there is no "Always send" and no telemetry.
- **The channel.** Main posts the Report to one Cloudflare Worker that validates it with the shared schema, files it through a GitHub App with `issues:write` on this repo only, labeled `needs-triage`, and keeps nothing (logs off; the IP only as a rate-limit key for the request). Fallback: copy the Report and open a pre-filled GitHub issue; offline, Copy only. The manifest's `reports` field is the kill switch.
- **No identifiers and no free content.** A random id per Report; every other field is a version, an enum value, an integer or a stack frame from the app's own code. Never a title, name, path, Setting value, Turn content or vendor message text. The fingerprint is the error code, else class plus top module and function. The app sends at most once per fingerprint per version; the Worker rate-limits per IP; matches update an Occurrences tally, and a match on a fixed issue from a newer version opens a regression issue.
- **Crashes** are detected with the app's own launch marker and structured records, never Electron's `crashReporter`: a renderer crash shows its band at once, a main crash on the next launch, a Provider host crash once restarts are exhausted and the band offers "Download <Provider> again", then "Report a problem…" if a fresh copy still fails ([§18](./18-offline-reconnect-and-error-states.md)). One band at a time; non-fatal errors never prompt. The manifest's `fixed` list drives "Your report #123 was fixed" in the what's-new screen after an update and "This is fixed in version F" on a crash band.
- **Diagnostics** hold schema entries only, in `userData/logs`, trimmed at 14 days or 5 MB, never archived; Copy, Export and Clear in Settings → Updates & About. A separate record of sent Reports outlasts them. Builds are unminified with modules as separate files; source maps stay on the maintainer's machine.

## Verify while building

- The Workers rate-limiting binding's period for the Report relay ([#47](https://github.com/qodesmith/unimatrix-zero/issues/47)).
