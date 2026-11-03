import {describe, expectTypeOf, it} from 'vitest'

import {useStateMachine} from './use-state-machine'

type Counter = {status: 'counting'; count: number} | {status: 'stopped'}

type CounterEvent = {type: 'added'; by: number} | {type: 'stopped'}

// @ts-expect-error a machine's state has a status
void (() => useStateMachine({transition: (n: number) => n, initial: 0}))

describe('useStateMachine', () => {
  it('sends only the machine’s events', () => {
    type Send = ReturnType<typeof useStateMachine<Counter, CounterEvent>>[1]

    expectTypeOf<Send>().toBeCallableWith({type: 'added', by: 2})
    // @ts-expect-error send accepts only the machine's events
    expectTypeOf<Send>().toBeCallableWith({type: 'flickered'})
  })
})
