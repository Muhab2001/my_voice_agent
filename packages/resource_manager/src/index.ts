export type PingReport<TDetails = string> = {
  healthy: boolean
  details: TDetails
}

export interface RemoteResource<TDetails = string> {
  ping(): Promise<PingReport<TDetails>>
  close(): Promise<void>
}

export class ResourceManager implements RemoteResource<Record<string, string>> {
  constructor(private readonly resources: Record<string, RemoteResource>) {}

  async ping(): Promise<PingReport<Record<string, string>>> {
    const entries = Object.entries(this.resources)
    const results = await Promise.allSettled(
      entries.map(([, resource]) => resource.ping()),
    )
    const details: Record<string, string> = {}
    let healthy = true

    for (const [index, [name]] of entries.entries()) {
      const result = results[index]
      if (result.status === 'fulfilled') {
        details[name] = result.value.details
        healthy &&= result.value.healthy
      } else {
        details[name] = failureReason(result.reason)
        healthy = false
      }
    }

    return { healthy, details }
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(
      Object.values(this.resources)
        .reverse()
        .map((resource) => resource.close()),
    )
    const failures = results
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      .map((result) => result.reason)

    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to close remote resources')
    }
  }
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
