import type { RemoteResource } from '@voice/resource-manager'
import type { Server } from 'bun'
import type { createApp } from './app.js'

export type ServerState = { shuttingDown: boolean }

export function startApiServer(
  app: ReturnType<typeof createApp>,
  resources: RemoteResource<Record<string, string>>,
  port: number,
  state: ServerState,
): Server<undefined> {
  const server = Bun.serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
  console.log(`API listening on ${port}`)

  async function shutdown() {
    if (state.shuttingDown) return
    state.shuttingDown = true

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const drained = server.stop()
    const deadline = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.error(
          'Shutdown drain deadline reached; closing remaining connections',
        )
        void server.stop(true).catch(console.error).finally(resolve)
      }, 10_000)
    })

    try {
      await Promise.race([drained, deadline])
    } finally {
      clearTimeout(timeoutHandle)
      await resources.close()
    }
  }

  process.once('SIGTERM', () => {
    void shutdown().catch(console.error)
  })
  process.once('SIGINT', () => {
    void shutdown().catch(console.error)
  })
  return server
}
