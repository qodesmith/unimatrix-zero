# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.

## `needs-provider`

Our own label, not one of the five roles above. It marks a ticket whose build or check needs a connected Provider in the dev app, so `/implement-next` stops and asks the human to connect one before building.

Decide it for every ticket you create or triage, beside its triage label. Apply it when the ticket:

- adds or changes a `*.live.test.ts` or a `[dep:<id>]` check
- changes behavior an entry in `docs/provider-dependencies.md` describes
- asks a question only a live Reply in the running app can answer
- asks for a bump PR, as `docs/provider-dependencies.md` defines it: its PR needs `bun run provider-checks` (both Providers)

When you apply it, name the Provider it needs (Claude, ChatGPT or both) and why: in the body when you write the ticket, or in a comment when you label one that already exists.
