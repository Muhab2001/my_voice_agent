import { expect, test } from 'bun:test'
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
    auxiliary: resource('auxiliary'),
  })

  const report = await manager.ping()
  await manager.close()

  expect(report).toEqual({
    healthy: true,
    details: {
      database: 'database is reachable',
      auxiliary: 'auxiliary is reachable',
    },
  })
  expect(calls).toEqual([
    'ping:database',
    'ping:auxiliary',
    'close:auxiliary',
    'close:database',
  ])
})

test('resource manager reports every failure without propagating a ping error', async () => {
  const manager = new ResourceManager({
    database: {
      ping: async () => ({ healthy: false, details: 'connection refused' }),
      close: async () => {},
    },
    auxiliary: {
      ping: async () => {
        throw new Error('Auxiliary timed out')
      },
      close: async () => {},
    },
  })

  expect(await manager.ping()).toEqual({
    healthy: false,
    details: {
      database: 'connection refused',
      auxiliary: 'Auxiliary timed out',
    },
  })
})
