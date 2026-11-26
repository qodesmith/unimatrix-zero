# Themes are versioned, token-only JSON

A Theme is a JSON document of token values (shadcn colors and radius, canvas colors, a Shiki theme name, a font family) with a `version` number and a `light` set, a `dark` set, or both. It never contains raw CSS. Themes are meant to be shared: users save their own and download them from the project's site or GitHub, so a Theme is untrusted input, and CSS can load remote content and restyle anything. Imported and user-made Themes are stored as JSON text in a `themes` table whose columns never change; the app validates each Theme when reading it and upgrades older versions in code, so the Theme format can change in any app update without a database migration. Findings: [Settings and user preferences](https://github.com/qodesmith/unimatrix-zero/issues/22).

## Considered Options

- **Raw CSS or arbitrary CSS variables.** Rejected: unsafe for shared files, and every refactor of the UI's styles would break existing Themes.
- **A table with one column per token.** Rejected: every new token would be a migration, and an unknown token in an imported file would have nowhere to go.
- **A separate JSON file per Theme on disk.** Rejected: everything else the app keeps lives in SQLite, and files add a second backup and rollback path.

## Consequences

- **At least one set is required.** A Theme with only one set uses it in every mode, and the light/dark/system control is disabled with a note ("This theme has a dark version only").
- **Missing tokens fall back** to the built-in Theme's set for the same mode; unknown keys are ignored. A file with no set, or no tokens, is rejected on import with a plain-language error.
- **Built-in Themes live in the app code**, defined in the same format, not in the database.
- **Styles use only theme tokens.** No hard-coded Tailwind colors anywhere in the UI, or Themes can't reach them.
- **Amended: missing colors are worked out from the Theme's own colors, not taken from the built-in Theme.** Each set needs `background`, `foreground` and `primary`. The app works out every other color from those three by blending: cards and popovers a step from the background, muted text partway to the foreground, borders and hovers as see-through tints that suit any surface. Any color the Theme gives wins. Taking the built-in Theme's value made mixed Themes: a cool blue dark Theme without `card` got Hearth's warm brown card. The second bullet's "fall back to the built-in Theme's set for the same mode" now holds only for radius, font and the Shiki name, which can't be worked out, and they come from the built-in set named like the Theme's own set, not the mode on screen, so a dark-only Theme takes dark values in every mode. A set missing any of the three colors is rejected on import with an error that names it. Built-in Themes still give every token. The blending runs in code when a Theme loads, not in the stylesheet, because Mermaid and the Theme picker need finished color values. Findings: [#99](https://github.com/qodesmith/unimatrix-zero/issues/99).
- **Amended: export writes a Theme as its author wrote it**, never the colors the app worked out, so better blending in a later update reaches it.
