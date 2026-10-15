# Visual identity: default Theme, feel and icon: what the user likes

Feeds the resolution of the Visual identity: default Theme, feel and icon ticket (#42).

**Verdict: direction A (calm, warm neutral), Theme "Hearth".** It's the default Theme in light and dark, and the mode follows the system by default. Warm off-white and warm greys, one clay accent (`#c2562f` light, `#e07a52` dark) used for primary buttons and the active Thread, soft radius (0.75rem), roomy spacing, Figtree. The app icon direction is A's sketch: a clay Prompt card splitting into two Reply cards on a warm tile. The tokens are in `themes.ts`.

Directions B (cool, tool-like), C (playful) and D (sci-fi/Borg) stay in the code as earlier options.

Deferred to a future dedicated effort on theming and visual design, not decided here:

- The final Theme token set, including whether density belongs in a Theme (ADR 0009 has no spacing token; the prototype set it outside the Theme).
- Whether B, C or D ship as extra built-in Themes.
- Final icon artwork for every OS size.
- Bundling the font (the prototype loads it from Google Fonts; the app must work offline).
- General UI polish from a design standpoint.
