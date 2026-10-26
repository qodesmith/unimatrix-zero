# Testing

Load this file when you write, run or fix a test.

## Put a test beside its unit

- A test sits beside the file it tests, named `<unit>.test.ts` or `<unit>.test.tsx`.
- The two Vitest projects, the Electron Node they run under and where CI runs each are in [README.md](../../README.md), section Tests.
- A renderer test runs in Chromium through `vitest-browser-react`: `render` and `renderHook` return promises, and `act` from `renderHook` is awaited too.

## Test this app's logic, never the framework or a library

- Ask of each test you add or change: "Which app rule makes this test fail when it breaks?" If no app rule can, the test checks the framework, a library or a fake. Delete it, or do not write it.

## Confirm that each new test can fail

- Break the behavior by hand, see the test go red, then restore it.

## Assert on what the unit produced, not on a value the test built. Enforced by: uz/no-fixture-assertion

The lint message says what to assert instead.

## Test every cell of a machine's transition table

- A machine test sits beside the machine (`machine.test.ts`) and checks every cell of the transition table, ignored events included. `canvas/chat-slideout/machine.test.ts` is the example.
- An ignored event, and an accepted event that changes nothing, return the same state object. Assert it with `toBe`, not `toEqual`.
- A state that the type must refuse gets a `@ts-expect-error` line in the test, so a later change that widens the type fails the typecheck.
- Write a bug again as a list of events in the machine test, before the fix.
- Test an action at the module boundary: assert the events it sends and the effects it calls.
