# Canvas mode UX: what the user likes

Running list from reviewing the prototype. Feeds the resolution of the Canvas mode UX ticket.

1. **Both orientations, user-switchable.** Canvas mode can lay the Tree out top-down or left-to-right, switched with a toggle. On switching, Turns animate to their new positions rather than jumping.
2. **Hover any Reply to reveal its Input; only the active Thread keeps one.** The Input appears when hovering over any Reply. Exactly one Input stays visible without hovering: on the active Thread's Reply. On opening a Tree, that's where you left off. Submitting a Prompt anywhere makes that Thread active immediately, and the old Input disappears. The new Reply gets the Input once it finishes streaming (a failed Reply gets Retry instead).
