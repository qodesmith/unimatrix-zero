import {expect, it} from 'vitest'

import {planOf} from './account'

it.each([
  ['Claude Pro', 'Pro'],
  ['Claude Max', 'Max'],
  ['Claude Team', 'Team'],
  ['Claude Enterprise', 'Enterprise'],
  ['Claude Max 20x', 'Max 20x'],
])('reads %s as the %s plan', (subscriptionType, plan) => {
  expect(planOf(subscriptionType)).toBe(plan)
})

it.each([['Claude API'], ['pro'], ['Claude '], [''], [undefined]])(
  'reads %s as no paid plan',
  subscriptionType => {
    expect(planOf(subscriptionType)).toBeNull()
  }
)
