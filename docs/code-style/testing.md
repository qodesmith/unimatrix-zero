# Testing

## Put a test beside its unit

- A test sits beside the file it tests, named `<unit>.test.ts` or `<unit>.test.tsx`.
- The two Vitest projects, the Electron Node they run under and where CI runs each are in [README.md](../../README.md), section Tests.
- A renderer test runs in Chromium through `vitest-browser-react`: `render` and `renderHook` return promises, and `act` from `renderHook` is awaited too.

## Test this app's logic, never the framework or a library

- Ask of each test you add or change: "Which app rule makes this test fail when it breaks?" If no app rule can, the test checks the framework, a library or a fake. Delete it, or do not write it.

## Confirm that each new test can fail

- Break the behavior by hand, see the test go red, then restore it.

## Control every source of nondeterminism a test asserts on

- A test controls every source of nondeterminism its assertions depend on: time, ordering, randomness, other processes. When it can't control one, it asserts nothing that depends on it.
- Inject the clock the code waits on. `heldIdle()` in `#modules/test-idle/main` is the example: in a driver test no idle time passes until the test passes it, so a warm vendor program closes only when the test says.
- Wait for something to happen with `vi.waitFor` or `expect.poll`. Its timeout only catches a hang.
- Assert that something has not happened only when nothing but the code under test could make it happen. While a real timer runs, that assertion is a race.
- A test that guards a race goes red on every run with the behavior broken, under CPU load too.
- A failure on a commit that passes in another run is a bug. Find the race, make it fail every time, then remove it. The fix keeps every timeout as it was, and adds no sleep and no retry; Vitest's `retry` stays unset.

## Assert on what the unit produced, not on a value the test built. Enforced by: uz/no-fixture-assertion

The lint message says what to assert instead.

## Test every cell of a machine's transition table

- A machine test (`machine.test.ts`) checks every cell of the transition table, ignored events included. `canvas/chat-slideout/machine.test.ts` is the example.
- An ignored event, and an accepted event that changes nothing, return the same state object. Assert it with `toBe`, not `toEqual`.
- A state that the type must refuse gets a `@ts-expect-error` line in the test, so a later change that widens the type fails the typecheck.
- Write a bug again as a list of events in the machine test, before the fix.
- Test an action at the module boundary: assert the events it sends and the effects it calls.
