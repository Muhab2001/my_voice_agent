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

test('resource manager drains dependents before closing their dependencies', async () => {
  const calls: string[] = []
  let finishVoice!: () => void
  const voiceClosed = new Promise<void>((resolve) => {
    finishVoice = resolve
  })
  const manager = new ResourceManager({
    database: {
      ping: async () => ({ healthy: true, details: 'ready' }),
      close: async () => {
        calls.push('database')
      },
    },
    voice: {
      ping: async () => ({ healthy: true, details: 'ready' }),
      close: async () => {
        calls.push('voice:start')
        await voiceClosed
        calls.push('voice:end')
      },
    },
  })

  const closing = manager.close()
  await Promise.resolve()
  expect(calls).toEqual(['voice:start'])

  finishVoice()
  await closing
  expect(calls).toEqual(['voice:start', 'voice:end', 'database'])
})

test('resource manager still closes dependencies after a dependent fails', async () => {
  const calls: string[] = []
  const manager = new ResourceManager({
    database: {
      ping: async () => ({ healthy: true, details: 'ready' }),
      close: async () => {
        calls.push('database')
      },
    },
    voice: {
      ping: async () => ({ healthy: true, details: 'ready' }),
      close: async () => {
        calls.push('voice')
        throw new Error('Voice cleanup failed')
      },
    },
  })

  await expect(manager.close()).rejects.toThrow(
    'Failed to close remote resources',
  )
  expect(calls).toEqual(['voice', 'database'])
})
