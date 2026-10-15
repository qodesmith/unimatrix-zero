# ⌘K search palette: what the user likes

Feeds the resolution of the ⌘K search: results, ranking, filters and empty state ticket (#44).

**Verdict: variant A (one row per Tree, like Notion), as built.** Variants B (Trees and Messages with a preview pane, typed filters, find bar) and C (live preview behind the palette) are dropped.

1. **Empty state:** "Recent", up to 8 Trees: the ones last opened from search first, then the rest by last activity. Each row shows the icon, title, 📁 Collection and relative time. Enter opens the Tree as it was left.
2. **One row per Tree.** The title (matches marked), 📁 Collection, Provider dots and last-active time, then one snippet line from its best match (the first matching Reply, otherwise the first match) with "You"/"Reply" and a Model pill on Replies. "▸ N more in this Tree" expands the row inline to every matching Turn; "▾ Hide matches" collapses it.
3. **Ranking ("Best match"):** a title match above everything else, then how many Turns match (with diminishing weight), then a nudge for recent activity. The sort menu also offers Last active and Date created.
4. **Matching:** every typed word has to appear in the same Turn (or in the title), matched from the start of a word, ignoring case and accents. Queries under 3 characters match anywhere. Searched: titles, Prompt text, the visible text of Replies, attachment file names (shown as 📎 name).
5. **Filters as chips under the input:** Titles only (toggle), 📁 Collection (any, one Collection, Not in a Collection), Provider (Trees that used Claude / used ChatGPT), Date (active today, past 7 days, past 30 days). An empty result with filters on says so and offers "Clear filters".
6. **Keyboard:** ↑↓ move, → expands a Tree's matches, ← collapses back to the Tree row, Enter opens, Esc closes. A footer lists them.
7. **Opening a result:** opens the Tree with the chat slideout on that Turn (a Tree row opens at its best match; a title-only match opens the Tree without a Turn). Only that Turn's matches are marked, on the canvas and in the slideout, scrolled into view inside long messages. Esc clears the marks.

For the real build: FTS5 per the full-text search research (`unicode61 remove_diacritics 2`, prefix queries per word, a plain scan for Chinese/Japanese and queries under 3 characters). The prototype's in-memory scorer stands in for FTS5 ranking plus the title boost and recency nudge; tune weights against real data. Recents in the prototype live in memory only.
