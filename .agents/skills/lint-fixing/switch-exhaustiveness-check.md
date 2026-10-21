# `typescript/switch-exhaustiveness-check`

This rule replaces `eslint/default-case`, which was syntactic only and could not tell an exhaustive switch from a leaky one.
This one is type aware, so when it fires the switch is genuinely incomplete.

## `Cases not matched: "x"`

The union has a member the switch does not handle, so add the missing `case`.
Keep the `default` out of it: a `default` turns a compile-time guarantee into a runtime fallthrough, which is the failure this rule exists to catch.

## `Cases not matched: default`

The discriminant is not a union, for example a `number` or a `string`, so exhaustiveness cannot be proved and a `default` is required (`requireDefaultForNonUnion: true`).
When the value _must_ be a closed set, narrow its type instead of adding the `default`.

## `default` on an exhaustive switch

Allowed, because `allowDefaultCaseForExhaustiveSwitch` keeps its default value `true`.
A `default: throw new Error(...)` is a fair defense against unvalidated data that crosses a boundary.
