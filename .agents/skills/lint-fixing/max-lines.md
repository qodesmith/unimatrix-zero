# Resolving `max-lines` violations

Split the file, instead of trimming it or raising the limit.
Each file the split creates must obey the limit itself, and the split is a structural refactor only, so the runtime behavior stays the same.

## Split inside the module

The file's module stays the owner of what it held, so the parts move to sibling files in the same module:

- Name each part for what it holds, after the files already in the module.
- Put a `.tsx` part under the module's `ui/` folder; `uz/tsx-under-ui` fails it anywhere else.
- Keep the module's `main.ts` as the only file other modules import. Re-export from it what callers already used, and nothing more; `uz/module-boundaries` fails an import that reaches past it.
- Put each shared constant, type, context, hook and helper beside the part that uses it, or in its own file when several parts share it.

Example, for a long `ui/Chart.tsx` in a `chart` module:

```
src/modules/chart/
  main.ts             # what other modules import, unchanged
  scale.ts            # shared constants, types and helpers
  ui/Chart.tsx        # composes the parts
  ui/ChartTooltip.tsx
  ui/ChartLegend.tsx
```

## Split the module

When the parts serve different callers, the file held two modules.
Give the second its own folder under `src/modules/` with its own `main.ts`, and import it through `#modules/<name>/main`.
