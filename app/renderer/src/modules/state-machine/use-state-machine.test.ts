import {describe, expect, it} from 'vitest'
import {renderHook} from 'vitest-browser-react'

import {machine} from './machine'
import {useStateMachine} from './use-state-machine'

type Counter = {status: 'counting'; count: number} | {status: 'stopped'}

type CounterEvent = {type: 'added'; by: number} | {type: 'stopped'}

const transition = machine<Counter, CounterEvent>({
  counting: {
    added: (state, {by}) => ({...state, count: state.count + by}),
    stopped: () => ({status: 'stopped'}),
  },
  stopped: {},
})

describe('useStateMachine', () => {
  it('starts in the initial state and runs the transition on each event it sends', async () => {
    const {result, act} = await renderHook(() =>
      useStateMachine({transition, initial: {status: 'counting', count: 1}})
    )

    expect(result.current[0]).toEqual({status: 'counting', count: 1})

    await act(() => result.current[1]({type: 'added', by: 2}))
    expect(result.current[0]).toEqual({status: 'counting', count: 3})

    // @ts-expect-error send accepts only the machine's events
    await act(() => result.current[1]({type: 'flickered'}))
    expect(result.current[0]).toEqual({status: 'counting', count: 3})
  })

  it('refuses a reducer whose state has no status', async () => {
    const {result} = await renderHook(() =>
      // @ts-expect-error a machine's state has a status
      useStateMachine({transition: (n: number) => n, initial: 0})
    )

    expect(result.current[0]).toBe(0)
  })
})
