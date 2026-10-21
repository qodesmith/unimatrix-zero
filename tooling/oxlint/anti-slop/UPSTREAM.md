# Upstream

- Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13).
- Installed with the `install-anti-slop` skill (`.agents/skills/install-anti-slop`, locked in `skills-lock.json`) from its bundled `assets/anti-slop`.
- Local changes: none beyond this repo's formatter. `oxlint.config.ts` enables a subset of the generic rules and none of the Effect rules.

## Update

Overwrite, then reformat. With no local changes there is nothing to merge, and the formatter's output is deterministic, so the diff is only what upstream changed.

1. `bunx skills update install-anti-slop` to pull the latest skill.
2. Move this file aside, delete the folder, and run `node .agents/skills/install-anti-slop/scripts/install.mjs tooling/oxlint/anti-slop`. Deleting first drops files upstream removed.
3. Restore this file with the new commit, then run `bun run fmt`.
4. Review `git diff tooling/oxlint/anti-slop` and turn on any new rules worth having.
