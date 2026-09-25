import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import type { RemoteResource } from '@voice/resource-manager'
import type { createApp } from './app.js'

export type ServerState = { shuttingDown: boolean }

export function startApiServer(
  app: ReturnType<typeof createApp>,
  resources: RemoteResource<Record<string, string>>,
  port: number,
  state: ServerState,
): Server {
  // With no TLS or HTTP/2 options, Hono's Node adapter creates an HTTP Server.
  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () =>
    console.log(`API listening on ${port}`),
  ) as Server

  async function shutdown() {
    if (state.shuttingDown) return
    state.shuttingDown = true

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const drained = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    )
    const deadline = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.error(
          'Shutdown drain deadline reached; closing remaining connections',
        )
        server.closeAllConnections()
        resolve()
      }, 10_000)
    })

    await Promise.race([drained, deadline])
    clearTimeout(timeoutHandle)
    await resources.close()
  }

  process.once('SIGTERM', () => {
    void shutdown().catch(console.error)
  })
  process.once('SIGINT', () => {
    void shutdown().catch(console.error)
  })
  return server
}
