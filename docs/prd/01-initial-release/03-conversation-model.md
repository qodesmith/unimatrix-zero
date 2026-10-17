# 3. Conversation model

Canonical in `CONTEXT.md`. The points everything else builds on ([Conversation model and v1 scope](https://github.com/qodesmith/unimatrix-zero/issues/18)):

- A **Tree** is made of **Turns**: a **Prompt** (exactly one user message) or a **Reply** (the AI's whole turn, however many tool calls, Subagents or thinking blocks it contains). A Prompt always follows a Reply except the root, and has at most one Reply.
- **Forks happen only at Replies.** A **Branch** is one direction taken from a Fork. There is no "main" Thread. A **Thread** is one root-to-leaf path: what the AI sees when continuing from that leaf.
- Several Threads can stream at once. A stopped or failed Reply is still a Reply and can be continued or branched from; a failed Reply can be retried in place (recovery, not a Fork).
- Deleting a Prompt deletes it and everything below it. There is no editing.
- **Context size** is the cumulative tokens along a Thread up to a Reply, reported by the Provider, never summed from Turns, and never including a Subagent's own tokens.
- The **Model** is chosen per Prompt; one Thread may pass through several Models and Providers, in the same Tree.
