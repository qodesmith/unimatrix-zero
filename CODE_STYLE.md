# Code style

Style rules for this repo, for humans and agents, used while writing code and while reviewing it.
Read this file first, then load the skill and the topic file for your task from `docs/code-style/`.

## What this file holds

A skill owns each general rule.
This file and its topics hold only what is true in Unimatrix Zero and not in every repo.
A rule that lint or a test enforces is not written out here: its topic names the rule, and the lint message carries the rest.

## Pick the task

Load the skill and the topic on the task's line.

- Write a function or a type, or parse data from outside the process: `/lint-fixing`, [platform](docs/code-style/platform.md).
- Edit an installed skill or the vendored anti-slop plugin: [platform](docs/code-style/platform.md).
- Write, amend or supersede an ADR, or name a domain concept: `/domain-modeling`, [platform](docs/code-style/platform.md).
- Write or change a skill, `AGENTS.md` or another doc an agent reads: `/writing-for-agents`. No topic.
- Write or change a comment: `/nuke-comments`. No topic.
- Add a package or a module, or import across modules: `/codebase-design`, [modules and state](docs/code-style/modules-and-state.md).
- Write local state, a state machine, or a read of browser state: [modules and state](docs/code-style/modules-and-state.md).
- Change main's SQLite schema: [modules and state](docs/code-style/modules-and-state.md).
- Write a class name, a CSS rule or a color: [styling and color](docs/code-style/styling-and-color.md).
- Write, run or fix a test: `/tdd`, [testing](docs/code-style/testing.md).
- Fix a lint error: `/lint-fixing`. No topic.

## Review a diff

A review covers every task the diff touches, so it loads every line above that matches a change in the diff, skill and topic both.
Comments changed in the diff bring in `/nuke-comments`; a changed skill or `AGENTS.md` brings in `/writing-for-agents`.
Names are checked against `GLOSSARY.md`, and each change against the ADRs in `docs/adr/` for its area.
