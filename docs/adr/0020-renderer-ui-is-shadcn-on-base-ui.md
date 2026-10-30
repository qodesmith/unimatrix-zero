# The renderer's UI is built from shadcn components in the Base UI flavor, never Radix

Every control and layout piece in the renderer is a shadcn component copied in with the `base-vega` style, so it runs on Base UI; a plain `<button>`, `<input>`, `<select>` or `<textarea>` appears only inside those copied components, and nothing imports Radix. One component family gives one look, one focus and keyboard behavior, and one set of Theme tokens across the app, and the copies are ours to change. Base UI over Radix because shadcn now ships both, Base UI is the one under active development by the same team, and mixing the two would bring two dialog, focus-trap and portal systems that disagree about which one owns Esc and focus. Findings: [#160](https://github.com/qodesmith/unimatrix-zero/issues/160).

## Considered Options

- **shadcn's Radix flavor.** Rejected: the older primitives, and the AI Elements patterns we copy are published for Base UI as well.
- **Hand-written controls.** Rejected: each one re-solves focus, keyboard and accessibility that the primitives already get right, and drifts in look.

## Consequences

- **Add components only with the `base-vega` style**, and copy AI Elements patterns only from their Base UI pages. The old AI SDK Elements registry depends on Radix and is never used.
- **`uz/shadcn-base-ui` enforces it**: plain controls outside `shadcn/ui` and any Radix import fail lint.
