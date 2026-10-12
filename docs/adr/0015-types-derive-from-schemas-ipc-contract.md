# Types derive from schemas; the IPC contract is its own source of truth

We never hand-write a type that can be derived from a schema. The IPC contract (commands, events and `SNAPSHOT`, [ADR 0013](0013-utility-process-per-provider-main-is-the-hub.md)) is defined as Zod schemas and is what the UI is promised, not a view of the database: main maps database rows to it, and that mapping is type-checked against both sides, so a migration breaks main's compile, not the UI. The obvious shortcut, deriving the UI's types from the Drizzle tables, would tie every screen to the storage layout. Findings: [Electron security posture](https://github.com/qodesmith/unimatrix-zero/issues/39).

## Consequences

- **Derive when two types describe the same fact; keep them separate when they only look alike.** Database row types come from the Drizzle tables and stay where they're used. The contract changes only when we decide the UI should see something different.
- **The same schemas validate at runtime.** Commands use `z.strictObject`, so unknown keys are rejected rather than stripped, and main runs `safeParse` before any handler ([ADR 0014](0014-electron-security-posture.md)).
- **Code lives in the process that needs it.** Shared code is only what more than one process needs, and must run correctly in any of them. Main, the Provider hosts and the renderer never import from each other, enforced by tooling rather than convention.
- **Vendor SDK types stay inside their Provider host**, which translates them into the contract's event schemas.
