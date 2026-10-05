# Themes are versioned, token-only JSON

A Theme is a JSON document of token values (shadcn colours and radius, canvas colours, a Shiki theme name, a font family) with a `version` number and a `light` set, a `dark` set, or both. It never contains raw CSS. Themes are meant to be shared: users save their own and download them from the project's site or GitHub, so a Theme is untrusted input, and CSS can load remote content and restyle anything. Imported and user-made Themes are stored as JSON text in a `themes` table whose columns never change; the app validates each Theme when reading it and upgrades older versions in code, so the Theme format can change in any app update without a database migration. Findings: [Settings and user preferences](https://github.com/qodesmith/unimatrix-zero/issues/22).

## Considered Options

- **Raw CSS or arbitrary CSS variables.** Rejected: unsafe for shared files, and every refactor of the UI's styles would break existing Themes.
- **A table with one column per token.** Rejected: every new token would be a migration, and an unknown token in an imported file would have nowhere to go.
- **A separate JSON file per Theme on disk.** Rejected: everything else the app keeps lives in SQLite, and files add a second backup and rollback path.

## Consequences

- **At least one set is required.** A Theme with only one set uses it in every mode, and the light/dark/system control is disabled with a note ("This theme has a dark version only").
- **Missing tokens fall back** to the built-in Theme's set for the same mode; unknown keys are ignored. A file with no set, or no tokens, is rejected on import with a plain-language error.
- **Built-in Themes live in the app code**, defined in the same format, not in the database.
- **Styles use only theme tokens.** No hard-coded Tailwind colours anywhere in the UI, or Themes can't reach them.
