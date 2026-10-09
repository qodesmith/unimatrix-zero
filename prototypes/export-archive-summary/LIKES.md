# Export, Archive and Summary entry points: what the user likes

Feeds the resolution of the Export, Archive and Summary entry points ticket (#30).

**Verdict: variant A (menus and dialogs), as is.** Variants B and C are dropped.

1. **A ⋯ menu on every Tree row in the sidebar:** Rename, Storage…, then Summarize this Tree…, Export Tree…, Archive…, then Delete…. It floats over the app, anchored to its row, and never scrolls the Tree list.
2. **A ⋯ menu on every Reply,** in canvas mode (Reply footer) and in the chat slideout: Summarize up to here…, Export Thread…, Copy as Markdown. Hidden on streaming and failed Replies.
3. **Export dialogs.** Export Thread: one Markdown file, root to that Reply, with a preview, Copy and Save…. Export Tree: choose One outline file (default) or One file per Thread (a folder), with a preview, Copy and Save…. Both say an Export can't be restored and point to Archive.
4. **Archive dialog** (one Tree, or Archive everything): what's inside with sizes (Turns and System prompts, attachments, Workspace files with every version, AI session data, plus Settings/System prompt library/Themes for everything), a total, "sign-ins are never included", and the fit check (size + 1 GB) before Save Archive…, offering another drive when it doesn't fit.
5. **Settings gets its own "Archive & restore" section** with Archive everything… and Restore…, and a line about dragging an Archive onto the window or double-clicking it.
6. **Restore preview, a dialog** shown before anything is written: Will be added / Different from yours / Already here, skipped. Each differing Tree gets Keep mine / Use archived with what each choice discards. Use archived that deletes Turns asks for a delete-style confirmation with the count. "Also use the Settings from this archive" is unticked and only shown for an Archive everything file. The size to write and free space are shown; Restore is blocked if it doesn't fit.
7. **Restore entry points:** Settings → Restore… (file picker), dropping an Archive anywhere on the window (a full-window "Drop to restore" overlay), or double-clicking the file (extension waits for the app name).
8. **Summaries:** a small start dialog (Model picker defaulting to the Reply's Model, or the default for a Tree; "Reads ~N tokens, in M parts"; the re-read note when the Provider differs; "made outside the Tree"), then a **non-modal panel floating bottom-right**: title, Model, split-run progress ("3 of 7 parts read, 3 at a time", then "Combining parts…"), streamed text, Stop with Esc, then Copy / Save as Markdown…, and Close, which asks "Discard this summary?" only if it wasn't copied or saved.
