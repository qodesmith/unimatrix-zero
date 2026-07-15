# Resolving `max-lines` violations

## React Components

When a React component file breaks `eslint(max-lines)`, split it into a folder rather than trimming or bumping the limit:

- Where the single-file <component>.jsx file use to be, create a folder of the same name
- Create an index.ts barrel file in that new folder that will be used to export everything the original single-file exported
- Break the original single-file component into individual component files inside that folder
- Extract any shared constants, types, context, hooks, or helper functions into their own separate file(s) in the folder
- Add all exports to the index.ts barrel file

Example — splitting a long `chart.tsx` file:

```
src/components/ui/chart/
  chart-container.tsx
  chart-tooltip.tsx
  chart-legend.tsx
  chart-context.tsx   # shared context + hook
  chart-utils.ts      # shared constants, types, helpers
  index.ts            # re-exports the original public surface
```

Notes:

- Files split into the subfolder must themselves adhere to the `eslint(max-lines)` rules
- This is a purely structural refactor — NO runtime behavior should change
