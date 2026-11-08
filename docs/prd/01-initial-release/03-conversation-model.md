# 3. Conversation model

Canonical in `GLOSSARY.md`. The points everything else builds on ([Conversation model and v1 scope](https://github.com/qodesmith/unimatrix-zero/issues/18)):

- A **Tree** is made of **Turns**: a **Prompt** (exactly one message) or a **Reply** (the AI's whole turn, however many tool calls, Subagents or thinking blocks it contains). A Prompt always follows a Reply except the root, and has at most one Reply.
- **Forks happen only at Replies.** A **Branch** is one direction taken from a Fork. There is no "main" Thread. A **Thread** is one path from the root to a Reply: what the AI sees when answering a Prompt sent into that Reply.
- Several Threads can stream at once. A stopped Reply is still a Reply and can be continued or branched from. A failed Reply is an Exchange that didn't happen: it shows only as a Failed chip with Retry (recovery, not a Fork), has no Input, and its Prompt goes back to the Input it was sent from; sending from there removes the failed Exchange, and the AI remembers nothing of it ([#200](https://github.com/qodesmith/unimatrix-zero/issues/200)).
- Deleting a Prompt deletes it and everything below it. There is no editing.
- **Context size** is the cumulative tokens along a Thread up to a Reply, reported by the Provider, never summed from Turns, and never including a Subagent's own tokens.
- The **Model** is chosen per Prompt; one Thread may pass through several Models and Providers, in the same Tree.
