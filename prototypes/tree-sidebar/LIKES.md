# Tree sidebar: what the user likes

Feeds the resolution of the Tree sidebar: organizing, searching, renaming, deleting ticket (#34).

**Verdict: variant B (folders and ⌘K), with the changes below.** Variants A (recent list) and C (search first) are dropped.

1. **Folders, one level, made by the user.** "＋📁" creates one and starts renaming it. Drag Trees onto a folder, or ⋯ → Move to folder…. Folders collapse. A folder's ⋯ has Rename folder and Delete folder; deleting a folder never deletes its Trees, which go back to the top level. Trees not in a folder sit below the folders. No pins.
2. **Sort menu (⇅):** Last active (default), Date created, Name. Each row shows the relative time for the chosen sort.
3. **Several Trees at once:** ⌘/Ctrl-click toggles, Shift-click selects a range. A bar at the bottom of the list shows "N selected" with Move to… and Delete…. Esc clears the selection.
4. **Search is a ⌘K palette,** opened by ⌘K or the "Search all Trees" button. It searches titles and the text of every Turn. Results are grouped by Tree (with its folder), up to 3 snippets each with "You"/"Reply" and the match highlighted, plus "+N more". ↑↓ and Enter open the Tree at that Turn in the chat slideout.
5. **Titles:** the root Prompt's first line, shown in italics, until the AI writes a title after the first Reply finishes (✦ briefly). Renaming by double-click, F2 or ⋯ → Rename is final; the AI never overwrites it.
6. **Row status:** a pulsing dot while a Reply streams anywhere in the Tree, and a red dot for a failure the user hasn't seen.
7. **Delete confirmation** (one or several Trees): the Turn count, every saved version of Workspace files deleted, "your linked folder stays where it is, untouched", "Deleting frees up to X", "can't be undone, Archive first", with Cancel / Archive first… / Delete.
8. **The ⋯ row menu:** Rename, Move to folder…, Storage…, then Summarize this Tree…, Export Tree…, Archive…, then Delete….
9. **Sidebar sections like VS Code's Explorer:** Trees above, Files below, with a draggable divider between them (Trees at least 120px, Files at least 180px). Files collapses from its ▾/▸ header to that header alone at the bottom, Trees taking the rest. While collapsed the divider can't be dragged. Expanding restores the earlier height.
10. **Sidebar width:** drag the right edge from 290px (the default, also the minimum) up to 640px. Double-click the edge, or the ⇤⇥ button in the header (shown only when wider than the default), to reset.
11. **Width, divider position and Files collapse survive switching Trees.**
12. **The Files badge says only where the files live.** Files kept in the app have no badge. A linked folder shows "🔗 path", up to 60% of the header, cut off at the end with "…". When cut off, hovering shows the full path in a tooltip that wraps only after a "/". Permissions (whether the AI can run commands) never appear here; they live in the Tools panel and approval cards.

For the real build: use shadcn's Resizable (`react-resizable-panels`) for both splits, with items 9 to 11 as its requirements. Check pixel minimums against its percentage sizes, add double-click reset, and lock the handle while Files is collapsed. The prototype's ResizeObserver deferral in `main.tsx` is a workaround; it doesn't carry over.
