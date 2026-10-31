# Layout is kept apart from Settings

How the window is arranged (whether the sidebar is open, and later its width, its dividers and which sections are collapsed) is saved in a Layout record of its own, with its own table, command and event, rather than as more keys in Settings. A Setting is a preference the user picks on the Settings page, and an option earns one only when reasonable users want either value and its default is known (PRD §17). Layout is whatever the user last left the window as, which the app restores on its own and never offers as a choice. Kept together, Settings would hold keys the Settings page has to skip, and every drag of a divider would publish a `SETTINGS_CHANGED` that every reader of Settings takes in. Findings: [#159](https://github.com/qodesmith/unimatrix-zero/issues/159).

## Considered Options

- **More keys in Settings.** Cheaper, since the table, the command, the event and the renderer store already exist. Rejected for the reasons above.
