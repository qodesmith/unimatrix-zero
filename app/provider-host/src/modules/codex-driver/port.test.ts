import {once} from 'node:events'
import {createServer} from 'node:net'
import {expect, it} from 'vitest'
import {z} from 'zod'

import {portFree} from './port'

it('says a port is taken while something listens on it, and free after', async () => {
  const holder = createServer().listen({host: '127.0.0.1', port: 0})
  await once(holder, 'listening')

  const {port} = z.object({port: z.number()}).parse(holder.address())

  expect(await portFree(port)).toBe(false)

  holder.close()
  await once(holder, 'close')

  expect(await portFree(port)).toBe(true)
})
