# The app owns the Tree; Provider sessions are disposable copies

Every Tree lives in the app's own SQLite database, which is the only source of truth: history is always rendered from it, never from a Provider's files. A Provider session holds a single linear Thread, so it can't represent Forks or a Thread that passes through several Providers, and Providers delete old sessions (Claude after 30 days by default). Each Reply stores its Provider session coordinates (Claude session id and message uuid, Codex thread id and turn id) only as references, saved once the Provider has persisted the Reply. Continuing resumes the session, branching uses the Provider's native fork at that Reply, and anything else (a missing or mismatched session, a different Provider) goes through one "rebuild session from Thread" path, which is always shown to the user and never silent.

## Considered Options

- **Provider sessions as the truth, with an index in the app.** Rejected: fails on Forks, on switching Provider, and on session cleanup.
- **Always rebuild from the app's copy, never resume.** Rejected: re-sends the whole Thread on every continuation (expensive on the $20 plans) and loses hidden reasoning and tool state.

## Consequences

- The app must store a provider-neutral copy of everything a rebuild needs, including original attachment files, never only a converted version.
- Context size comes from Provider-reported usage per Reply, not from summing Turns, because rebuilt or compacted sessions diverge.
- A stopped Reply's partial text is stored by the app, because Providers drop the half-streamed part.
