import type { RemoteResource } from '@voice/resource-manager'
import type { Server } from 'bun'
import type { createApp } from './app.js'
import type { VoiceSessionManager } from './voice/session-manager.js'

export type ServerState = { shuttingDown: boolean }

export function startApiServer(
  app: ReturnType<typeof createApp>,
  resources: RemoteResource<Record<string, string>>,
  port: number,
  state: ServerState,
  voice: VoiceSessionManager,
): Server<undefined> {
  const server = Bun.serve({
    fetch(request, server) {
      if (
        /^\/v1\/voice\/sessions\/[^/]+\/ui-events$/.test(
          new URL(request.url).pathname,
        )
      ) {
        server.timeout(request, 0)
      }

      return app.fetch(request)
    },
    port,
    hostname: '0.0.0.0',
  })
  console.log(`API listening on ${server.port}`)

  async function shutdown() {
    if (state.shuttingDown) {
      return
    }
    state.shuttingDown = true

    const shutdownDeadline = Date.now() + 12_000
    // One hard deadline includes resource cleanup, even if a database or Redis operation stalls.
    const hardTimeout = setTimeout(
      () => {
        console.error(
          'Shutdown deadline reached; cancelling remaining operations',
        )
        voice.forceClose()
        void server.stop(true)
        process.exit(1)
      },
      Math.max(1, shutdownDeadline - Date.now()),
    )

    let drainTimeout: ReturnType<typeof setTimeout> | undefined
    const drained = Promise.all([
      server.stop(),
      voice.drain(shutdownDeadline - 3000),
    ])
    const deadline = new Promise<void>((resolve) => {
      drainTimeout = setTimeout(
        () => {
          console.error(
            'Shutdown drain deadline reached; closing remaining connections',
          )
          voice.forceClose()
          void server.stop(true).catch(console.error).finally(resolve)
        },
        Math.max(1, shutdownDeadline - 3000 - Date.now()),
      )
    })

    try {
      await Promise.race([drained, deadline])
      clearTimeout(drainTimeout)
      await resources.close()
      clearTimeout(hardTimeout)
    } finally {
      clearTimeout(drainTimeout)
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
