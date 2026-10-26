## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`qodesmith/unimatrix-zero`) via the `gh` CLI, including where research findings go. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Spelling

US English (color, behavior, labeled, organize) everywhere you write: code, docs, commits, issues and PRs. Installed skills under `.agents/skills/` and the vendored `tooling/oxlint/anti-slop/` keep their authors' spelling; `bun run lint` checks everything else.

### Code style

Read [CODE_STYLE.md](./CODE_STYLE.md) before writing or reviewing code, a test or a doc: it names the skill and the topic file for each task.
