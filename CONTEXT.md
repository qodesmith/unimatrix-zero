# Unimatrix Zero

A desktop control surface for a user's existing AI subscriptions (Claude, ChatGPT) where a conversation is a branching tree rather than a single line.

## Language

### Providers

**Provider**:
An AI service the user connects through their own subscription (Claude, ChatGPT). A Tree may involve several Providers. Users _connect_ a Provider; _sign in_ refers only to the Provider's own sign-in page.
_Avoid_: Vendor, backend, service

### Conversation structure

**Tree**:
The whole branching structure of one conversation, grown from a single root Prompt. One canvas holds exactly one Tree.
_Avoid_: Canvas (as a noun for the data), chat, session

**Turn**:
One box in the Tree: either a Prompt or a Reply.
_Avoid_: Node, box, message

**Prompt**:
A user's Turn: exactly one message. A Prompt always follows a Reply (except the root) and is followed by at most one Reply.
_Avoid_: User message, question

**Reply**:
The AI's Turn in response to one Prompt, however many internal messages, tool calls, or thinking blocks it contains.
_Avoid_: Response, answer, completion

**Thread**:
One path from the Tree's root to a leaf: the complete, linear conversation the AI sees when continuing from that leaf. A Tree with no Forks has exactly one Thread; there is no "main" Thread.
_Avoid_: Conversation (ambiguous between Tree and Thread), main thread, trunk

**Fork**:
A Reply with two or more Prompts responding to it. Forks only ever happen at Replies.
_Avoid_: Split, fork point

**Branch**:
One of the directions taken from a Fork: a child Prompt of the Fork and everything below it. As a verb, _to branch_ is to respond to a Reply that already has a response, turning it into a Fork.
_Avoid_: Using "branch" for a Reply with only one response; that's just the conversation continuing.

**Exchange**:
A Prompt together with its Reply. In horizontal canvas mode, each Exchange is drawn as one card (Prompt as header, Reply as body); in vertical mode they're separate boxes.
_Avoid_: Card, pair, round

**Context size**:
The cumulative tokens along a Thread up to a given Reply: what the AI carries if the conversation continues from there.
_Avoid_: Token count (ambiguous with the Turn's own size)

### Views

**Canvas mode**:
The app's main view: a whole Tree laid out spatially on an infinite canvas, in one of two orientations, vertical (top-down, the default) or horizontal (left-to-right). Orientation is a global preference, not per Tree.

**Chat mode**:
One Thread of a Tree shown as a conventional vertical chat, in a slideout over canvas mode that opens when you click any Turn and can expand to full screen. It is not a separate view; to switch Threads, click another Turn on the canvas.
_Avoid_: Drawer, chat view

**Input**:
The place the user types the next Prompt, always attached to a Reply, except on an empty Tree, where a single Input creates the root Prompt. Chat mode has exactly one, at the end of the shown Thread. In canvas mode every Reply can have one: it is always shown on the active Thread and revealed on hover elsewhere, and submitting into a Reply that already has a response branches.
_Avoid_: Composer, prompt box, head
