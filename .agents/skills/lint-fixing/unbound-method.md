# `typescript/unbound-method`

The rule reports every method that code passes as a value, even one that never reads `this`.
It checks the syntax, not the body.
Its help text offers `this: void` first.
That silences the rule, but it adds a parameter that is not an argument, and it keeps `this` in code that is not a class.

Test files have this rule off: `expect(fake.method)` passes the method as a value by design.

## Write a member passed as a value as a standalone function

A function declaration has no `this` to lose, so it passes as a value with no binding, and its signature shows only its real parameters.
Fix the member once, not each call site with a wrapper or a `.bind`.

Before: `items.filter(rules.isVisible)` reports, because `isVisible` is a method.

```ts
export const rules = {
  isVisible(item: Item) {
    return !item.hidden
  },
}
```

After: the module exports the function, and callers pass it as it is.

```ts
export function isVisible(item: Item) {
  return !item.hidden
}
```

## Keep the method syntax on a member that code only calls

A member that code calls, and never passes as a value, gets no report.
Drop its `this: void`, and keep it as a method.

## Wrap a built-in method at the call site

A report on a method of a built-in or library class is a real bug.
`items.map(cache.get)` on a `Map` throws a `TypeError` when it runs, and TypeScript does not catch it.
You cannot change the class, so wrap the call where it is passed.

```ts
items.map(key => cache.get(key))
```
