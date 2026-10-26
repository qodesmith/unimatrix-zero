export interface MachineState {
  status: string
}

export interface MachineEvent {
  type: string
}

/**
 * A handler is pure: one that mutates the state and returns it reads as
 * unchanged. A non-literal `status` or `type` gives its handler `never`.
 */
export type Transitions<S extends MachineState, E extends MachineEvent> = {
  [K in S['status']]: {
    [T in E['type']]?: (
      state: Extract<S, {status: K}>,
      event: Extract<E, {type: T}>
    ) => S
  }
}

// Method syntax makes the parameters bivariant, so each narrow handler fits one wide signature.
type Handler<S, E> = {bivariant(state: S, event: E): S}['bivariant']

type Table<S, E> = Record<string, Record<string, Handler<S, E> | undefined>>

function shallowEqual(a: MachineState, b: MachineState) {
  const before = Object.entries(a)
  const after = new Map(Object.entries(b))

  return (
    before.length === after.size &&
    before.every(
      ([key, value]) => after.has(key) && Object.is(after.get(key), value)
    )
  )
}

/**
 * The pure transition function. Ignored events, and results shallow-equal to
 * the input, return the input object.
 */
export function machine<S extends MachineState, E extends MachineEvent>(
  transitions: Transitions<S, E>
) {
  const table: Table<S, E> = transitions

  return function transition(state: S, event: E) {
    const row = Object.hasOwn(table, state.status)
      ? table[state.status]
      : undefined

    const handler =
      row && Object.hasOwn(row, event.type) ? row[event.type] : undefined

    if (!handler) return state

    const next = handler(state, event)

    return shallowEqual(state, next) ? state : next
  }
}

/** The context of a compound that runs a machine in its provider. */
export interface MachineContext<S, A, M = Record<string, never>> {
  state: S
  actions: A
  meta: M
}
