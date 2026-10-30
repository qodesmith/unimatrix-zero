# Testing

## Put a test beside its unit

- A test sits beside the file it tests, named `<unit>.test.ts` or `<unit>.test.tsx`.
- The two Vitest projects, the Electron Node they run under and where CI runs each are in [README.md](../../README.md), section Tests.
- A renderer test runs in Chromium through `vitest-browser-react`: `render` and `renderHook` return promises, and `act` from `renderHook` is awaited too.

## Test this app's logic, never the framework or a library

- Ask of each test you add or change: "Which app rule makes this test fail when it breaks?" If no app rule can, the test checks the framework, a library or a fake. Delete it, or do not write it.
- A test of a thin wrapper goes red when the wrapper's own wiring changes. Remove the prop or the call the wrapper adds; if the test stays green, it tests the library underneath.
- A rule the code already checks when it loads, such as a schema parsed at import, or one the typecheck enforces, needs no runtime test that restates it.
- Assert the behavior a constant, a table name or a class name drives, not the value itself. A copy of the value goes red only when someone edits it.
- Assert what the unit handed a fake: the URL it fetched, the command it sent. What the fake hands back is the test's own value.

## Confirm that each test can fail

- Break the behavior by hand, see the test go red, then restore it. Break the behavior, not a line: where the code guards a rule twice, remove both guards.
- Every assertion needs a break that turns it red. An assertion no break reaches is dead, even inside a test that other assertions keep honest.
- Each clause of a test's name is a claim, and each claim gets an assertion that goes red when it is false.
- Note which other tests go red on the same break. If one already does, extend that test instead of adding another.
- Name each break in the PR body: what you changed, and which test went red.

## Control every source of nondeterminism a test asserts on

- A test controls every source of nondeterminism its assertions depend on: time, ordering, randomness, other processes. When it can't control one, it asserts nothing that depends on it.
- Inject the clock the code waits on. `heldIdle()` in `#modules/test-idle/main` is the example: in a driver test no idle time passes until the test passes it, so a warm vendor program closes only when the test says.
- Wait for something to happen with `expect.poll`.
- Every limit only catches a hang. `vitest.config.ts` sets the node project's test, hook and poll limits that way, so a test sets no shorter one of its own.
- Assert that something has not happened only when nothing but the code under test could make it happen, and only after reaching the state where broken code would make it happen. While a real timer runs, that assertion is a race.
- To show a promise is still pending, race it against `setTimeout(resolve, 0)` under real timers: broken code settles before the timer fires, and only the test can settle working code. `claude-driver/warm.test.ts` is the example. An already-resolved promise wins every race and proves nothing.
- A test that guards a race goes red on every run with the behavior broken, under CPU load too.
- A failure on a commit that passes in another run is a bug. Find the race, make it fail every time, then remove it. The fix adds no sleep and no retry, and Vitest's `retry` stays unset.
- Raise a limit only when it was checking speed rather than catching a hang. A longer limit never fixes a race.

## Assert on what the unit produced, not on a value the test built. Enforced by: uz/no-fixture-assertion

The lint message says what to assert instead.

## Check a type rule with the typecheck

- A value that the type must refuse gets a `@ts-expect-error` line in the test, so a later change that widens the type fails the typecheck. Such a test renders and runs nothing.
- Put the `@ts-expect-error` on a call that infers the generics, the way real code calls it. `expectTypeOf(fn).toBeCallableWith` checks only the generic constraints, so it stays green when one is dropped. `state-machine/use-state-machine.test.ts` is the example.

## Test every cell of a machine's transition table

- A machine test (`machine.test.ts`) checks every cell of the transition table, ignored events included. `canvas/chat-slideout/machine.test.ts` is the example.
- An ignored event, and an accepted event that changes nothing, return the same state object. Assert it with `toBe`, not `toEqual`.
- A state that the type must refuse gets a `@ts-expect-error` line, as in [Check a type rule with the typecheck](#check-a-type-rule-with-the-typecheck).
- Write a bug again as a list of events in the machine test, before the fix.
- Test an action at the module boundary: assert the events it sends and the effects it calls.
