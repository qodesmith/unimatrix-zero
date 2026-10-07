# Archives are their own versioned format, not a copy of the database

An Archive is a zip of our own documented JSON documents (a manifest, one document per Tree, plus Settings, the System prompt library and Themes in "Archive everything") alongside the files they need: attachments named by SHA-256, each Workspace's hidden store as a git bundle plus its large-file folder, and Provider session data as opaque files. The manifest carries a format `version`. A newer app upgrades older Archives in code; an older app refuses a newer Archive with "This archive needs a newer version of the app". Archives live outside the app for years, so tying them to the database schema would make every migration a compatibility break for files already in the wild; this mirrors Themes ([ADR 0009](0009-themes-are-versioned-token-only-json.md)) and the database's refusal of newer versions ([ADR 0003](0003-migration-foreign-key-guard.md)). Findings: [Exporting and restoring Trees](https://github.com/qodesmith/unimatrix-zero/issues/27).

## Considered Options

- **Zip a copy of the SQLite rows or the database file.** Rejected: every migration would also have to upgrade old Archives, and the internal schema would become a public file format.

## Consequences

- **Archives contain everything.** Every Turn, every version of every Workspace file (large files included, per [ADR 0010](0010-linked-folder-holds-one-thread.md)), and Provider session data, so restored Trees continue exactly. Never sign-ins: the app keeps no secrets of its own. Ignored files such as `.env` and `node_modules` aren't in the store, so they aren't archived.
- **Restore is either/or per Tree.** New Trees are added; identical Trees are skipped; for a Tree that differs the user picks Keep mine or Use archived, shown with the Turn counts each choice discards. Use archived is a user deletion of the local-only Turns, with the same confirmation. No merging and no keeping both: both would need id remapping ([ADR 0002](0002-uuidv7-ids.md)) and would let two Trees share one Provider session. Merging can be added later without changing the format.
- **Ids are kept on restore**, since a restored Tree is never a second copy of a Tree already present.
- **Building an Archive always re-hashes Workspace files** rather than trusting size and modified time.
