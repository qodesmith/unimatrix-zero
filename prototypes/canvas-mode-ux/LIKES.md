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
9. **Context size meter, as an option.** A thin bar along a Reply's bottom edge that fills as the Thread's Context size approaches the model's limit (as in variant B). It is a user setting, not always on.
10. **Visual behaviour is user-configurable.** Scrolling long messages with "Show more" / "Show less" is also a setting, and settings should drive nearly all visuals. Captured in the Settings and user preferences ticket.
11. **Center on submit.** Submitting a Prompt from any Input smoothly pans the canvas to center the new message, keeping the current zoom.
12. **Delete from a Prompt, as an overlay.** Hovering a Prompt reveals a delete control that sits on top of the content. Its inline "Delete N Turns?" confirm deletes the Prompt and everything below it. Neither state shifts the layout.
13. **Stop and failure states.** A streaming Reply has a Stop button, and Esc stops it too, as in the CLI. Stopping calls the provider's interrupt. A stopped Reply shows a "Stopped" tag and can still be replied to or branched from. A failed Reply shows a red border and Retry in place.
14. **Context size badge always shows** on every Reply, with the per-Turn size on hover. The meter stays optional.
15. **Canvas feel.** Scroll pans; pinch or ⌘-scroll zooms. Turns can't be dragged, because the layout comes from the Tree. Branches read oldest-first.
16. **Chat slideout.** Clicking any message opens a right-side slideout showing that Thread as a normal chat, with an Input to continue from its last Reply (branching if needed) and Context size in its footer. The canvas pans so the clicked Turn stays visible, and the slideout's Thread is highlighted.
17. **Grouped canvas controls.** The minimap, zoom controls and orientation toggle sit together as one control. Orientation defaults to vertical, is global (not per Tree), and will be a Settings option.
