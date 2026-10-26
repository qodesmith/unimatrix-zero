# Styling and color

## Style with Tailwind utilities at the call site

- Express styling as Tailwind utilities at the call site. Tailwind v4 covers more than it looks like it does: gradients, arbitrary stop positions and color mixes all have utilities, so "the design needs real CSS" is usually wrong.
- When a class of our own earns reuse, declare it with `@utility` in `styles.css` rather than as a bare class: a utility takes variants (`hover:`, `dark:`) and shows up in IntelliSense.

## Give a bare class in `styles.css` its reason

- A bare class carries a comment right above it saying why it cannot be a utility. The reasons are narrow: the class name comes from a dependency's markup, such as React Flow's `.react-flow__edge`; there is no utility equivalent (`@keyframes`, a CSS variable a library reads); or it needs a specific cascade position.

## Reach every color through a Theme token. Enforced by: uz/no-hardcoded-colors, scripts/check-css-tokens.ts

- The tokens and where they live are in [README.md](../../README.md), section Colors, and the decision is [ADR 0009](../adr/0009-themes-are-versioned-token-only-json.md).
- **Consistency beats local preference.** A tone reached through a token follows the Theme into both Hearth sets, light and dark; a hand-picked one is tuned for the set it was picked in and reads wrong in the other. When Hearth lacks a tone, add a token to both sets rather than writing a one-off at the call site.

## Pick a tone by meaning, one tone per concept

- **Map by hue, not by invented severity.** Greenish is `success`, reddish is `destructive`.
- **No mapping means no color.** A category that is not a state goes neutral: `muted-foreground` for text, `bg-muted` for fills. Its icon and label already tell it apart.
- **One tone per concept, app-wide.** The same state renders the same tone wherever it is drawn: a failed Reply is `destructive` on the canvas and in the slideout alike.
