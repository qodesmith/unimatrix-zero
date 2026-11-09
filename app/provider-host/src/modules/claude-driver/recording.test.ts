import {accountDetailsIn} from '#modules/test-recordings/main'
import {expect, it} from 'vitest'

import {RECORDINGS} from './replay'

it('holds no email, home folder or account id but the stand-ins in a committed recording', () => {
  expect(
    accountDetailsIn(RECORDINGS, [
      'sam@example.com',
      '/Users/sam',
      '-Users-sam',
      '00000000-0000-4000-8000-000000000000',
    ])
  ).toEqual([])
})
