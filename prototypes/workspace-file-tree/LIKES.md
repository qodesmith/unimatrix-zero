# Workspace file tree and canvas: what the user likes

Running list from reviewing the prototype. Feeds the resolution of the Workspace file tree and canvas ticket.

**Verdict: variant A, plus C's file chips.** Variants B and C are dropped otherwise.

1. **One sidebar: Trees above, files below.** The view-only file tree shows the Workspace as it was at the Turn selected on the canvas (otherwise the active Thread's leaf), coloured by what that Reply added, changed or deleted.
2. **The file tree follows the canvas; no folders that mirror the Tree.** C's one-folder-per-Segment view is dropped: files repeat in every folder.
3. **No Segments in the UI.** C's Segment bands are dropped, so v1 has no use for the term.
4. **File chips on Replies (from C).** A Reply that changed files lists them under its text as chips, like Prompt attachments: thumbnail or icon, name, what happened (created, edited, deleted) and size. Clicking a chip opens that file as it was at that Reply. Commands run show as chips too. This replaces A's compact "+1 ~1" badge.
5. **The chat slideout lists each file change** of the Reply it shows.
6. **Live files vs. earlier versions.** Only a Thread's leaf is on disk, so "Open in default app" and "Reveal in Finder" appear only there. Earlier Turns get "Open this version" and "Save a copy…".
7. **Focusing a leaf Input makes its Thread the one everything follows.** It highlights the Thread's path, makes it the active Thread (the sidebar files follow it), clears a clicked message's selection and closes the chat slideout. The canvas doesn't pan. Leaving the Input keeps the Thread active.
8. **Previews in three tiers.**
   - **In the app (Chromium does it):** images (fit / actual size), audio and video players, PDF, Markdown, CSV as a table, code and text. A file counts as text by its bytes, not its extension. A video whose codec can't play falls back to the card.
   - **The OS for everything else:** on macOS, Quick Look (`previewFile()`) for Office, Keynote, Photoshop and the like, with OS thumbnails (`nativeImage.createThumbnailFromPath`) and file icons (`app.getFileIcon`).
   - **A fallback card** when nothing can show it: icon or thumbnail, name, type, size, modified, plus the actions in item 6.
9. **Size limits.** Text over a cap previews its start with "Open to see the rest"; very large files aren't previewed. Large binaries at earlier Turns show "No earlier version kept" instead of "Open this version" (the prototype uses 100 MB). Files stream through a custom protocol with range requests, never loaded whole into the page.
10. **Plain Trees** show an empty files area with "Add files to this Tree", which chooses between keeping the files in the app and linking a folder.

To verify before relying on it: Electron's bundled codecs (H.264, AAC), whether its PDF viewer is on by default, and calling `previewFile()` from the renderer.
