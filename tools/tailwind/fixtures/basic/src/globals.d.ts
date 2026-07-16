// Excluded from scanning — walk() skips .d.ts files. If it didn't, the
// cn(...) span below would leak w-[64px] into the analysis.
declare function cn(first: 'w-[64px]'): string
