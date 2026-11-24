import {EXTRACTION_PORT_MESSAGE as SENT} from '@uz/contract/extraction'
import {expect, it} from 'vitest'

import {EXTRACTION_PORT_MESSAGE} from './extraction-port'

it('listens for the port under the name main sends it by', () => {
  expect(EXTRACTION_PORT_MESSAGE).toBe(SENT)
})
