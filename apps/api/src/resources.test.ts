import { expect, test } from 'bun:test'
import { RedisCache } from '@voice/cache'
import { type RemoteResource, ResourceManager } from '@voice/resource-manager'

test('resource manager pings and closes every resource', async () => {
  const calls: string[] = []
  const resource = (name: string): RemoteResource => ({
    ping: async () => {
      calls.push(`ping:${name}`)
      return { healthy: true, details: `${name} is reachable` }
    },
    close: async () => {
      calls.push(`close:${name}`)
    },
  })
  const manager = new ResourceManager({
    database: resource('database'),
    redis: resource('redis'),
  })

  const report = await manager.ping()
  await manager.close()

  expect(report).toEqual({
    healthy: true,
    details: {
      database: 'database is reachable',
      redis: 'redis is reachable',
    },
  })
  expect(calls).toEqual([
    'ping:database',
    'ping:redis',
    'close:redis',
    'close:database',
  ])
})

test('resource manager reports every failure without propagating a ping error', async () => {
  const manager = new ResourceManager({
    database: {
      ping: async () => ({ healthy: false, details: 'connection refused' }),
      close: async () => {},
    },
    redis: {
      ping: async () => {
        throw new Error('Redis timed out')
      },
      close: async () => {},
    },
  })

  expect(await manager.ping()).toEqual({
    healthy: false,
    details: {
      database: 'connection refused',
      redis: 'Redis timed out',
    },
  })
})

test('cache Aside loads once, stores JSON, and returns cached values', async () => {
  const values = new Map<string, string>()
  const client = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value)
    },
  } as unknown as ConstructorParameters<typeof RedisCache>[0]
  const cache = new RedisCache(client)
  let loads = 0
  const load = () => {
    loads++
    return { items: [1, 2] }
  }

  expect(await cache.Aside('answer', 30, load)).toEqual({ items: [1, 2] })
  expect(await cache.Aside('answer', 30, load)).toEqual({ items: [1, 2] })
  expect(loads).toBe(1)
})

test('cache Aside returns before its background write finishes', async () => {
  let finishWrite: (() => void) | undefined
  const pendingWrite = new Promise<void>((resolve) => {
    finishWrite = resolve
  })
  const client = {
    get: async () => null,
    set: async () => pendingWrite,
  } as unknown as ConstructorParameters<typeof RedisCache>[0]
  const cache = new RedisCache(client)

  expect(await cache.Aside('answer', 30, () => 'loaded')).toBe('loaded')
  finishWrite?.()
})
