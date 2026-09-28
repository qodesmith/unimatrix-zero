# Canvas mode UX: what the user likes

Running list from reviewing the prototype. Feeds the resolution of the Canvas mode UX ticket.

**One end state.** Canvas mode is a single design with two orientations: vertical (top-down, from variant A) and horizontal (left-to-right, from variant B). Both share the same features, look and feel; they differ only where orientation obviously forces it (for example, one card per exchange in horizontal mode, and where the Input docks). Every item below applies to both unless it names a mode.

1. **Both orientations, user-switchable.** Canvas mode can lay the Tree out top-down or left-to-right, switched with a toggle. On switching, Turns animate to their new positions rather than jumping.
2. **Hover any Reply to reveal its Input; only the active Thread keeps one.** The Input appears when hovering over any Reply. Exactly one Input stays visible without hovering: on the active Thread's Reply. On opening a Tree, that's where you left off. Submitting a Prompt anywhere makes that Thread active immediately, and the old Input disappears. The new Reply gets the Input once it finishes streaming (a failed Reply gets Retry instead).
3. **Long messages scroll inside their box.** Long Prompts and long Replies keep a fixed maximum height and scroll within it by default (as in variant B), instead of being clipped or growing the layout. Scrolling inside a message scrolls the text, not the canvas. Any message that overflows (Prompt or Reply) gets a "Show more" / "Show less" toggle that expands it to full height. While a Reply streams, it stays scrolled to the newest text unless the user has scrolled up.
4. **Horizontal mode: one card per exchange.** In left-to-right mode, a Prompt and its Reply share a single card (Prompt as header, Reply as body), as in variant B.
5. **Vertical mode: Prompts as wide as Replies.** In top-down mode, Prompt and Reply boxes are the same width; background colour alone tells them apart.
6. **Fork pill.** A Reply that is a Fork shows a small pill in its top-right corner with its Branch count ("Fork · 5 Branches"), as in variant A.
7. **Thread path highlighting.** The connections from a Turn back to the root are highlighted. By default that's the active Thread. Hovering any message temporarily switches the highlight to that message's path. Typing into any Input highlights that Input's path, and it wins over hover while the user types.
8. **Minimap.** Both modes show a minimap of the whole Tree, placed where it doesn't cover content or controls.
