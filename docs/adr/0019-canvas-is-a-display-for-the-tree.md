# Canvas mode is a display for the Tree, rendered with React Flow; chat mode is a slideout over it

Canvas mode is the app: the whole Tree laid out from its structure by React Flow (xyflow), with Turns that cannot be dragged, Branches read oldest-first, and vertical (default) and horizontal orientations that share every feature. Chat mode is not a second view but a slideout over the canvas that opens on the Thread of whichever Turn is clicked and can go full screen. We chose React Flow over tldraw, the inspiration for the canvas feel, because the canvas is a display for structured data, not a drawing surface: the layout comes from the Tree, so tldraw's drawing tools and its licensing questions buy nothing. A separate chat view was dropped because switching Threads would then need its own navigation, while clicking a Turn on the canvas already says which Thread to show. Findings: [Canvas engine](https://github.com/qodesmith/unimatrix-zero/issues/19), [Canvas mode UX](https://github.com/qodesmith/unimatrix-zero/issues/14), [Chat mode Thread navigation and switching between modes](https://github.com/qodesmith/unimatrix-zero/issues/15). Amended: the slideout opens from a button on each Reply rather than a click anywhere on a Turn, so a click meant for a Turn's content opens nothing; the canvas is still the Thread switcher.

## Considered Options

- **tldraw.** Rejected: a freeform drawing engine whose value is in tools the Tree never needs, with licensing to think about. It stays an inspiration for feel.
- **A custom canvas.** Rejected: React Flow already does nodes, edges, panning, zooming and a minimap, and the Tree's layout is computed from data either way.
- **Chat mode as a separate view with a Thread switcher.** Rejected: the canvas is the Thread switcher.

## Consequences

- **Layout is a pure function of the Tree's structure.** There is no saved position per Turn.
- **Orientation is a global Setting**, not a per-Tree property, since both orientations show the same Tree.
- **Opening a Tree at a Turn** (from search, or from a Reply's Subagent chip) means opening the slideout on that Turn's Thread, never a different screen.
