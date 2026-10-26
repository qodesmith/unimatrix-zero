# Platform

Load this file when you write a function or a type, parse data from outside the process, edit vendored code, or write an ADR.

## Keep functions small

- Keep functions and components small, easy to read and easy to change.
  `complexity` (15 per function) and `max-lines` (400 per file) are the hard limits; reaching one means the code wants splitting, and the `lint-fixing` skill has the split.

## Parse rather than assert, and derive types from the schema

- Data that crosses a process boundary is parsed by its Zod schema, and its type derives from that schema ([ADR 0015](../adr/0015-types-derive-from-schemas-ipc-contract.md)).
  A hand-written type that repeats a schema is a second source of truth, and drifts from it.
- Prefer inference. Annotate where a type is a deliberate contract between functions.
- `typescript/no-unsafe-type-assertion` and `anti-slop/no-runtime-typeof` are on. Narrow with a schema or a named type predicate, never with `as`.

## Edit only the code this repo owns

- A skill listed in `skills-lock.json` is installed from upstream, and `bun run skills:update` overwrites it. Change it upstream, or wrap it in a skill of our own.
  The skills in `.agents/skills/` that `skills-lock.json` does not list are ours, and we edit them in place.
- `tooling/oxlint/anti-slop/` is a vendored copy of upstream, and the `install-anti-slop` skill updates it. Its `UPSTREAM.md` records the source commit, the local changes and the update steps.

## Record a decision in an ADR, and a fact about the code in its topic file

- An ADR in `docs/adr/` records one decision and why. It changes when the decision changes, never when the implementation does.
- A sentence that names a file, an export or a script belongs in the topic file under `docs/code-style/` that covers it, or in a comment at that code, citing the ADR.
- A domain term lives in `GLOSSARY.md`, and code uses its name for it. Write, amend or supersede both through the `domain-modeling` skill.
