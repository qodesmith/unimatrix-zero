---
name: tailwind-canonical-classes
description: Use to fix suggestCanonicalClasses Tailwind IntelliSense lint errors
---

The entire pipeline is implemented deterministically in
`tools/tailwind/canonicalize-classes.ts` — do not reimplement it.

1. Dry run and review the output:

   ```sh
   bun tools/tailwind/canonicalize-classes.ts
   ```

   - `VERIFIED MAPPING` pairs compile to equivalent CSS and are safe to apply
   - `REJECTED` pairs are engine suggestions that failed CSS-equivalence
     verification (e.g. `rounded-[4px]` → `rounded-lg` when `:root` overrides
     `--radius`) — leave them alone; they are real regressions, not bugs in
     the tool

2. Apply: `bun tools/tailwind/canonicalize-classes.ts --apply`

3. Sanity check with `bun run lint` and `bun run typecheck` (these only catch
   botched string edits, not CSS equivalence — the tool's verifier handles
   that)

The script reads the design system css path from `components.json`, extracts
class tokens from className attrs and cn/cva/clsx/tv/twMerge calls under
`src/`, canonicalizes via `designSystem.canonicalizeCandidates` (rem: 16),
and verifies each pair with `candidatesToCss` before rewriting. It is also
importable: `canonicalizeTailwindClasses({projectRoot, srcDirs, rem, apply})`.
