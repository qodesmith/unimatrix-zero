# Three kinds of Setting, and a Tree may use its own Permission mode

Settings had one rule: global, and it never changes an existing Tree. The Compaction Settings ([#218](https://github.com/qodesmith/unimatrix-zero/issues/218)) and the Permission mode ([ADR 0022](./0022-one-kind-of-tree-and-permission-modes.md)) broke it: both shape what the AI does, and both reach every Tree at once. Each new Setting would otherwise settle the question again.

Every Setting is now one of three kinds:

- **Look and behavior:** global. It applies at once and never reaches the AI.
- **Defaults for new Trees:** copied into a Tree when it is created, and never changing an existing one.
- **Live AI Settings:** global, reaching every Tree from the next AI call. A Tree may use its own value instead, where the Setting allows one.

The Permission mode is the first live AI Setting that allows a Tree its own value. The label beside the Input, which sits inside one Tree, changes that Tree's mode, and the global mode is set in Settings. Decided in [#230](https://github.com/qodesmith/unimatrix-zero/issues/230), with the inventory of every Setting in [its first comment](https://github.com/qodesmith/unimatrix-zero/issues/230#issuecomment-6980060393).

## Considered Options

- **The Permission mode global only, as ADR 0022 had it.** Rejected: the label is inside one Tree, yet a change there reached every Tree. A user who switched to Full access to let one task finish widened every other Tree too, and nothing in those Trees showed it.
- **A Tree's mode copied from the global one when the Tree is created**, as the Tools panel's defaults are. Rejected: tightening the global mode later would reach no existing Tree.
- **The label changes the global mode, with a "Just this Tree" choice in its menu.** Rejected: one menu would hold two scopes.
- **Picking the global mode's own value in the label means following the global mode.** Rejected: "this Tree is always Supervised" is a real need, and the menu has a separate item for following.
- **Asking only about Trees wider than the new global mode on a ladder** (Full access, Auto, Auto-accept edits, Supervised). Rejected: Auto and Auto-accept edits don't compare. Auto lets the Reviewer approve edits outside the Tree, and leaving the Sandbox, with no card. Auto-accept edits shows a card for both. Under Auto, the Reviewer can also refuse things Auto-accept edits lets run.
- **A Tree's own Compaction Settings now.** Deferred. Nobody needs them yet, and a Tree that switches Provider would need all three values. They are a live AI Setting, so a Tree can be given its own later with no new decision.
- **A reach note under every control**, as #218 placed them. Rejected: the same sentence repeats down the page, and notes on look-and-behavior controls say what the user already expects.
- **A library entry added later switches on in every existing Tree.** Rejected: under Full access, the default, an MCP server with a local command would run in every Tree. Each server's tools would also use Context in every Tree.

## Consequences

- **Which kind each Setting is.**
  - **Look and behavior:** the theme mode and the Theme, Font size, canvas orientation, "Limit height of long messages", the Context size meter, the send key, the re-read note, Esc stops a Reply, and update checks.
  - **Defaults for new Trees:** the default System prompt, the Tools defaults, and each library entry's "On in new Trees".
  - **Live AI Settings:**
    - the Permission mode, which a Tree may override;
    - the Compaction Settings, which reach every Thread from its next Reply and no Tree overrides in v1;
    - the Summary prompts, which no Tree overrides, since a Summary belongs to no Tree's Replies.
- **The libraries are content, not Settings**, as Themes are. Editing or deleting an MCP server, Skill or Plugin entry reaches every Tree that uses it. An entry added later is on in new Trees and off in existing ones, and the toast that confirms the addition offers "Turn on in this Tree". A System prompt library entry is copied into a Tree, so editing it changes no existing Tree.
- **A Tree's effective Permission mode** is its own mode if it has one, and the global mode otherwise. Each Reply runs under its Tree's effective mode, from the next Reply, as ADR 0022 had it for the global mode. The files section of the prompt names it.
- **The label beside the Input** shows the Tree's effective mode, with "· this Tree" when the Tree has its own. Its menu acts on this Tree only: the four modes, and "Use the global mode (X)", with a check on the current choice. Picking any mode, the global mode's own value included, gives the Tree its own mode.
- **The Tree panel** is where a Tree's own values are shown and changed: its System prompt, its Tools panel, its Permission mode, and its "Always allow in this Tree" grants, each of which can be revoked. It opens from the Tree menu. "Keep the folder in sync with the selected Thread" stays with the folder's actions in the Files header.
- **Settings → Permissions** is a section of its own, before Tools. It holds the global mode and says how many Trees use their own mode, with a list linking to each Tree panel and "Reset all to global". The Tools section then holds only defaults for new Trees and the libraries.
- **The narrowing prompt.** When the global mode changes, a prompt lists every Tree whose own mode is not narrower than or equal to the new global mode. The order is partial: Full access is the widest and Supervised the narrowest, and Auto and Auto-accept edits each count as wider than the other.
  - Each listed Tree has a checkbox, all ticked. "Switch these" removes the ticked Trees' own modes.
  - Closing the prompt keeps every Tree's own mode, and the global change applies either way. The line counting Trees with their own mode is the reminder that stays.
- **Archive and restore keep a Tree's own mode within the global mode.**
  - An Archive holds each Tree's own mode and its "Always allow in this Tree" grants.
  - On Restore, every comparison uses the global mode after the restore: the archive's when "Also use the Settings from this archive" is ticked, and this computer's otherwise.
  - A restored Tree whose own mode is wider than that global mode is listed in the preview with "Keep it", unticked. Its "Always allow in this Tree" grants are listed too, and are dropped unless the user keeps them.
  - When the archive's Settings would widen the global mode, the preview says so beside that checkbox ("Sets the Permission mode to Full access (this computer: Supervised)"). When they would narrow it, the preview lists the Trees already here that the narrowing prompt would list.
- **Skills.**
  - **The vendors' default Skill folders** (`~/.claude/skills`, `~/.agents/skills`) are library folders the user adds with one click, with no Setting of their own.
  - **Codex reads `~/.agents/skills` whatever its config folder is.** So the app rescans that folder at the start of every Codex thread and writes an off-rule for each Skill that isn't on in that Tree. A Skill that appears later in an added folder follows the library rule: off in existing Trees, on in new ones. A Skill found in two folders shows once in the Tools panel.
  - **A linked folder's own Skills** (`.agents/skills` and `.claude/skills`) belong to the Tree, as its `CLAUDE.md` and `AGENTS.md` do. They load on both Providers from each Thread's working copy, rescanned whenever a thread starts. They show in the Tools panel as "From this folder", listing the selected Thread's Skills, or the Skills of the Thread in the folder when no Thread is selected. Each switch is kept per Tree by Skill name, and a Skill that appears later is on. Parent folders' Skills are switched off, as their `CLAUDE.md` and `AGENTS.md` are never read.
- **Reach on the Settings page is shown per group.**
  - Every group holds controls of one reach only.
  - A group of look-and-behavior Settings has no note.
  - Every other group has one note saying how far its controls reach, worded in PRD §17.
- **Amends ADR 0022**: its "The Permission mode is global only" and the label changing the global mode.
