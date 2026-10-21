# `typescript/no-unsafe-type-assertion`

These three make the lint pass without fixing anything, so leave them out:

- `x!`. A different rule, `typescript/no-non-null-assertion`, fires on it.
- A type argument that says what a call returns, like `querySelector<HTMLInputElement>()`.
- A type predicate that does not check what it claims. The rule skips the signature, so a `value is T` that returns `true` is never caught.

Test files have this rule off. Build a partial fake there with `fromPartial` from `@total-typescript/shoehorn`, rather than `as unknown as T`, which `anti-slop/no-chained-type-assertions` fails.

## Data from outside the program

Parse it with a Zod schema: JSON from a file or a process, YAML frontmatter, an IPC payload, a `require()` result.
The contract's schemas already cover what crosses IPC (ADR 0015).
If the old code fell back to `'{}'`, give each field a `.default(...)` so the fallback still parses.

## A `string` checked against keys or a list

`key in record` does not narrow a `string` key. A predicate does.

```ts
export function isKeyOf<Key extends string, Value>(
  record: Partial<Record<Key, Value>>,
  key: PropertyKey
): key is Key {
  return Object.hasOwn(record, key)
}
```

`Partial` lets it take an interface with optional fields.
For a list, put `(VALUES as readonly string[]).includes(value)` inside a `value is Value` predicate. That `as` widens, so it passes.
Both need a closed type. `VALUES` must be `as const`, and on a `Record<string, T>` the predicate narrows nothing.

## An object literal cast to its type

Change `as Config` to `satisfies Config` on the literal itself.
It fails on a variable declared earlier, because that variable already widened.
`satisfies` reports the missing field, and you add it.

## A lookup table keyed by a `string`

A `Record<string, T>` annotation on a literal fails `anti-slop/no-known-value-widening`, and indexing the inferred literal type with a `string` fails typecheck.
Use a `Map`, whose `get` returns `T | undefined`:

```ts
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
])
const mimeType = mimeTypes.get(ext)
```

## `event.target` in a React handler

`event.currentTarget` is typed as the element the handler is on, so `new FormData(event.currentTarget)` and `event.currentTarget.value` need no cast.
`ChangeEvent` types `target` the same way, so the cast there was never needed.
React sets `currentTarget` to `null` once the handler returns. Read it before the first `await`.
When one handler on a list needs the clicked descendant, narrow with `event.target instanceof HTMLButtonElement`.

## Keys and entries of a closed record

Only the caller knows a record is closed, so one helper per claim states it in its signature and keeps the cast behind a comment that says why it holds.

```ts
export function keysOf<Key extends string, Value>(
  record: Partial<Record<Key, Value>>
): Key[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- closed record: the caller's type lists every key
  return Object.keys(record) as Key[]
}
```

`value as T` inside a generic, where only the caller knows `T`, is already such a helper. A registry lookup is the common case.
Keep the cast behind `-- caller-typed lookup: only the caller knows what it registered under key`.
