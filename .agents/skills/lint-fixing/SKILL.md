---
name: lint-fixing
description: 'Use when an oxlint error has a gotcha the obvious fix misses: complexity, max-lines, no-unsafe-type-assertion, promise-function-async, switch-exhaustiveness-check, unbound-method, or any anti-slop rule.'
---

# Lint fixing

When one of these rules fires, read its file before you fix the code.
A rule that is absent here has no known gotcha, so fix it normally.

- `eslint/complexity`: [complexity.md](complexity.md)
- `eslint/max-lines`: [max-lines.md](max-lines.md)
- `typescript/no-unsafe-type-assertion`: [no-unsafe-type-assertion.md](no-unsafe-type-assertion.md)
- `typescript/promise-function-async`: [promise-function-async.md](promise-function-async.md)
- `typescript/switch-exhaustiveness-check`: [switch-exhaustiveness-check.md](switch-exhaustiveness-check.md)
- `typescript/unbound-method`: [unbound-method.md](unbound-method.md)
- `anti-slop/*`: the rule's source in `tooling/oxlint/anti-slop/rules/`, and its violation example in the [upstream README](https://github.com/dmmulroy/anti-slop#violation-examples)

## Disable a rule only with its reason

Fix the code first.
When the code is right and the rule is wrong for it, such as a real I/O boundary that takes `unknown`, disable the rule on that line and give the reason after `--`, so a reviewer can argue with it:

```ts
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the IPC boundary: CommandSchema parses it below
```

A disable comment that stops suppressing anything fails the lint run, so delete it with the code it covered.
