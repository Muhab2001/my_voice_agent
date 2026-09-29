import { errorSchema } from '@voice/contracts'
import { env } from '../env'

const apiBase = env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

export type HttpRequestInput = {
  path: `/${string}`
  method: 'GET' | 'POST'
  body?: unknown
  accessToken?: string | null
  signal?: AbortSignal
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchApi({
  path,
  method,
  body,
  accessToken,
  signal,
}: HttpRequestInput): Promise<Response> {
  const headers = new Headers()
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  const body = errorSchema.safeParse(await response.json().catch(() => null))
  throw new ApiError(
    body.success
      ? body.data.error.message
      : `Request failed (${response.status})`,
    response.status,
    body.success ? body.data.error.code : undefined,
  )
}
