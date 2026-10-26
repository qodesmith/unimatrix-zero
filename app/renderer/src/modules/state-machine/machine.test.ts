import type {MachineContext, Transitions} from './machine'

import {describe, expect, expectTypeOf, it} from 'vitest'

import {machine} from './machine'

type Lamp =
  | {status: 'off'}
  | {status: 'on'; level: number; label: string | undefined}

type LampEvent =
  | {type: 'switchedOn'; level: number}
  | {type: 'switchedOff'}
  | {type: 'dimmed'; level: number}
  | {type: 'labeled'; label: string | undefined}

const lamp = {
  off: {
    switchedOn: (_state, {level}) => ({status: 'on', level, label: undefined}),
  },
  on: {
    switchedOff: () => ({status: 'off'}),
    dimmed: (state, {level}) => ({...state, level}),
    labeled: (state, {label}) => ({...state, label}),
  },
} satisfies Transitions<Lamp, LampEvent>

const transition = machine<Lamp, LampEvent>(lamp)

const lit = {status: 'on', level: 3, label: undefined} satisfies Lamp

describe('machine', () => {
  it('runs the handler the state lists for the event', () => {
    expect(transition({status: 'off'}, {type: 'switchedOn', level: 5})).toEqual(
      {status: 'on', level: 5, label: undefined}
    )
    expect(transition(lit, {type: 'dimmed', level: 1})).toEqual({
      status: 'on',
      level: 1,
      label: undefined,
    })
  })

  it('returns the same object for an event the state does not list', () => {
    const off = {status: 'off'} satisfies Lamp

    expect(transition(off, {type: 'dimmed', level: 1})).toBe(off)
    expect(transition(off, {type: 'switchedOff'})).toBe(off)
  })

  it('returns the same object for an event type the machine does not know', () => {
    // @ts-expect-error a transition accepts only the machine's events
    expect(transition(lit, {type: 'flickered'})).toBe(lit)
  })

  it('returns the same object for an event type that only the object prototype has', () => {
    // @ts-expect-error a transition accepts only the machine's events
    expect(transition(lit, {type: 'toString'})).toBe(lit)
    // @ts-expect-error a transition accepts only the machine's events
    expect(transition(lit, {type: 'constructor'})).toBe(lit)
  })

  it('returns the same object for a status that only the object prototype has', () => {
    const odd = {status: 'constructor'}

    // @ts-expect-error a transition accepts only the machine's states and events
    expect(transition(odd, {type: 'keys'})).toBe(odd)
  })

  it('returns the input object when the result is shallow-equal to it', () => {
    expect(transition(lit, {type: 'dimmed', level: 3})).toBe(lit)
    expect(transition(lit, {type: 'labeled', label: undefined})).toBe(lit)
  })

  it('returns the new object when one field changed', () => {
    const labeled = {status: 'on', level: 3, label: 'Desk'} satisfies Lamp

    expect(transition(labeled, {type: 'labeled', label: undefined})).toEqual(
      lit
    )
    expect(transition(lit, {type: 'labeled', label: 'Desk'})).toEqual(labeled)
  })

  it('tells a missing field from a field that holds undefined', () => {
    interface Slot {
      status: 'slot'
      a?: number
      b?: number
    }

    const move = machine<Slot, {type: 'moved'}>({
      slot: {moved: () => ({status: 'slot', b: undefined})},
    })

    const before = {status: 'slot', a: undefined} satisfies Slot

    expect(move(before, {type: 'moved'})).toStrictEqual({
      status: 'slot',
      b: undefined,
    })
  })

  it('returns the new object when the result adds a field', () => {
    interface Note {
      status: 'note'
      text?: string
    }

    const write = machine<Note, {type: 'written'}>({
      note: {written: () => ({status: 'note', text: 'Draft'})},
    })

    expect(write({status: 'note'}, {type: 'written'})).toEqual({
      status: 'note',
      text: 'Draft',
    })
  })
})

// @ts-expect-error every status must appear in the table
void machine<Lamp, LampEvent>({off: {}})

void machine<Lamp, LampEvent>({
  off: {},
  on: {
    // @ts-expect-error an event type the machine does not have
    flickered: (state: Lamp) => state,
  },
})

void machine<Lamp, LampEvent>({
  off: {
    // @ts-expect-error a handler must return a state of the machine
    switchedOn: () => ({status: 'broken'}),
  },
  on: {},
})

describe('MachineContext', () => {
  it('gives a compound context no meta unless it names some', () => {
    expectTypeOf<
      MachineContext<Lamp, {switchOff: () => void}>
    >().toEqualTypeOf<{
      state: Lamp
      actions: {switchOff: () => void}
      meta: Record<string, never>
    }>()
  })
})
