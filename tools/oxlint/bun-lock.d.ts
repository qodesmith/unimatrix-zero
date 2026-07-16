// Shape of Bun's bun.lock (JSONC), narrowed to what check-oxlint-drift.ts
// reads. Package entries are tuples whose first element is "<name>@<version>".
declare module '*/bun.lock' {
  const lock: {
    packages: Record<string, [string, ...unknown[]] | undefined>
  }
  export default lock
}
