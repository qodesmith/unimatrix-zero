// Exists only to appease lint — the tests never read this file. It lets
// button.tsx's `./cn` import resolve for type-aware oxlint (TS2307 can't be
// disabled per-glob). A .d.ts (not .ts) so the analyzer skips it — the
// scanned-file set the tests assert on stays stable.
export declare function cn(...classes: (string | false)[]): string
