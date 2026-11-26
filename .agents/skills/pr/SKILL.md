---
name: pr
description: "Use when writing a PR body."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

A PR body has two halves. The first half is read by everyone. The second half is read by the reviewer who wants to dig.

```markdown
## What this PR does

- <bullet>
- <bullet>
- <bullet>

## Try it

1. <one action>
2. <one action>
3. <what you should see>

### Screenshots

| Before | After |
|---|---|
| <img alt="Before" src="<url>" /> | <img alt="After" src="<url>" /> |

## Details

<diagram, diff-sketch, or tree>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <one-word description>

<optional: potential ramifications of merge>
```

## What this PR does

Three to six bullets. A reader who stops here knows the whole change.

Write each bullet like a smart engineer talking across a desk: plain English, answer first, one change per bullet, under 15 words. Say the user-visible effect before the mechanism ("The contract panel's scrollbar now follows the theme", then how). Open with the issue ref if there is one (`Fixes #123`).

Prose rules for this section:

- Short word over long word: "fix" over "implement a solution for".
- One idea per sentence, active voice, 20 words max.
- Plain text. Bold and inline code only for a name the reader must search for.
- Every not, never, no, only survives. Clarity beats compression.
- Keep tangents (reverted commits, drive-by test fixes, what is left for another PR) out of this section. They go under Details.

## Try it

Numbered steps the reader follows to see the change, or to reproduce the bug it fixes. Write for someone who knows the project: skip setup they do anyway, and name a mode or a precondition only when it matters ("With the fake backend running").

- One action per step: click, scroll, type, select, run. Name the text on screen in bold: "Click **New project**".
- The last step says what the reader should see. For a bug fix, it says what used to happen and what happens now.
- When nothing shows on screen, the steps are commands and the output to expect.

Leave the section out when the reader has nothing to do: a refactor, or a change only tests can show. CI covers those.

### Screenshots

Add screenshots only when the change is visual and the environment can capture it. Capture the part that changed (a panel, a dialog, a row), and the whole window only when the change spans it.

- A change to something already on screen gets a before and an after, side by side in the two-column table.
- Something new gets one after shot, with no table.
- Keep the `<img>` tag GitHub writes on upload, minus its `width` and `height`, so the browser sizes the image.

Leave the sub-section out when nothing changes on screen.

## Details

Everything else lives here, and it may be long. Pick the smallest view that makes the key point clear. Use the user's domain language from `GLOSSARY.md`.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```text
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with Mermaid:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic: a component tree, a file layout, a call tree, or a control-flow sketch.

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape.

For a bug fix, show the test that pins it, in pseudocode: what it checks, and that it fails without the fix.

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to make the point. You may use one of these, you may use several, it is unlikely you will use all of them.

Tangents go here too, each under its own short sub-heading: a commit that was superseded, a pre-existing failure this PR also repairs, work deliberately left for another PR.

## Merge Danger

Describe whether it is a one-way or two-way door. You can walk back through two-way doors, but not one-way doors. Changes that involve destructive actions or hard-to-reverse decisions are one-way doors.

The blast radius is the potential scope of the change. Consider all possibilities: layout shift, breakages for consumers, mobile responsiveness.

## Pre-send check

1. Does the first section stand alone? A reader who stops there has the whole picture.
2. Does any bullet in the first section open with context or mechanism instead of the change? Flip it.
3. Did a tangent sneak into the first section? Move it to Details.
4. Can the reader follow Try it without asking you anything? Each step names one action and the text on screen, and the last says what they should see.
