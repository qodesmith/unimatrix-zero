# Modules and state

## Keep each module deep. Enforced by: uz/module-boundaries, uz/tsx-under-ui

The layout, and why only `@uz/contract` crosses between processes, are in [README.md](../../README.md), sections Layout and Modules.

## Name code after the Glossary

- A type, a field or a function for a domain concept uses the `GLOSSARY.md` name and means what its entry says.
  An `interface Turn` that holds something the Glossary does not call a Turn is a bug, even when the code works: fix the name or the entry, through the `domain-modeling` skill.

## Give every row a UUIDv7, and migrate through Drizzle

- Ids are UUIDv7 strings, never SQLite integers ([ADR 0002](../adr/0002-uuidv7-ids.md)).
- A change to main's SQLite schema ships with its migration: the steps are in [README.md](../../README.md), section Layout ([ADR 0003](../adr/0003-migration-foreign-key-guard.md)).

## Read browser state through a store

- Browser state outside React (a media query, `localStorage`, the window's size) reaches a component through `useSyncExternalStore` or a `@tanstack/react-store` store, never an effect that copies the value into state.
  `canvas/reduced-motion.ts` and `connections/connections-store.ts` are the examples.

## Make local state a state machine when it has phases

- Make state a machine when it has phases, or when some combinations of its fields are invalid. A single toggle and independent fields stay `useState`.
- A machine has four parts: a state union, events named in the past tense (`opened`, `dismissed`), a pure transition that looks at the state first, and effects outside the machine.
- Time, ids and random values come in the event (`{type: 'answered', answer, at}`), so the same events always give the same state.
- Data from the query cache and from main stays out of machine state. The runner reads it beside the machine and sends an event when it changes what the machine should do.

## Write the transitions with `machine()`, and run them with `useStateMachine`

- `machine()` from `#modules/state-machine/main` builds the transition function from a table keyed by `status`. Write the table with `satisfies Transitions<State, Event>`, or give it inline (`machine<State, Event>({...})`). In both forms the typecheck refuses a missing status.
- An event that a state does not list, and a result shallow-equal to its input, return the input object, so React bails out of the update.
- `useStateMachine({transition, initial})` runs the machine and returns `[state, send]`. Call it rather than `useReducer` for a machine.
- A reader that branches on two or more states uses an exhaustive `switch` on `status`. A check for one state may use `status ===`.

## Pick the runner for the machine

- When one component reads the state and needs nothing more than `send`, that component calls `useStateMachine`.
- When the runner also reads data beside the machine, or hands callbacks to other components, it is a hook beside the machine, `use-<machine>.ts`, returning its own object. `canvas/chat-slideout/use-chat-slideout.ts` is the example: it sends `arrived` once the Tree has the Reply it follows.
- In a compound, the provider runs the machine, and `MachineContext<State, Actions, Meta>` in `state-machine/machine.ts` types its context. The first compound that needs it exports it from the module's `main.ts`.

## Put effects in an actions file, and only when an operation has one

- An actions file exists only when an operation has effects, such as a `bridge().send`, a timer or a write to Settings. A machine with no effects, such as `chat-slideout/`, has none.
- Each action takes one `input` object. It never sets machine state, and changes the machine only through `send`.
- The runner reads the effects from hooks and passes them in: `send`, the query client, a ref. They are not static imports.

## Give each machine a folder in its module

- Each machine is a folder in its module, one folder for each machine:
  - `machine.ts`: the state union, the event union, the initial state and the transition function.
  - `actions.ts`: only when an operation has effects.
  - The runner hook, when the runner is not the one component that reads the state. A runner component is `.tsx`, so it lives under the module's `ui/`.
- Testing a machine is in [testing](testing.md).
